import { MongoClient } from "mongodb";
import { env } from "node:process";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { eventsPageResponseSchema } from "../../src/grant-admin/schemas/events-page-response.schema.js";
import { cwStubRequests, resetCwStub, setCwStub } from "../helpers/cw-stub.js";
import { wreck } from "../helpers/wreck.js";

let client;
let inbox;
let outbox;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  inbox = client.db().collection("inbox");
  outbox = client.db().collection("outbox");
});

afterAll(async () => {
  await client?.close();
});

beforeEach(async () => {
  await resetCwStub();
});

// The pollers rewrite PUBLISHED, FAILED and RESUBMITTED rows while a test runs,
// so only terminal statuses are seeded here.
const at = (minute) =>
  new Date(Date.UTC(2026, 5, 16, 10, minute)).toISOString();

const inboxDoc = (n, overrides = {}) => ({
  messageId: `msg-page-${n}`,
  type: "cloud.defra.local.fg-cw-backend.case.status.updated",
  source: "CW",
  status: "COMPLETED",
  completionAttempts: 1,
  eventTime: at(n),
  publicationDate: at(n),
  lastResubmissionDate: null,
  completionDate: at(n),
  segregationRef: `PAGE-${n}`,
  lastError: null,
  event: { id: `evt-page-${n}`, time: at(n), data: { clientRef: "SECRET" } },
  claimedBy: null,
  claimedAt: null,
  claimExpiresAt: null,
  ...overrides,
});

const deadInboxDoc = (n, message = "No handler found") =>
  inboxDoc(n, {
    status: "DEAD_LETTER",
    completionDate: null,
    completionAttempts: 5,
    lastError: { name: "Error", message, at: at(n) },
  });

const outboxDoc = (n, overrides = {}) => ({
  target:
    "arn:aws:sns:eu-west-2:000000000000:gas__sns__create_new_case_fifo.fifo",
  status: "COMPLETED",
  completionAttempts: 1,
  publicationDate: new Date(Date.UTC(2026, 5, 16, 10, n)),
  lastResubmissionDate: null,
  completionDate: at(n),
  segregationRef: `PAGE-${n}`,
  lastError: null,
  event: {
    id: `evt-page-${n}`,
    type: "cloud.defra.local.fg-gas-backend.case.create",
    time: at(n),
    data: { clientRef: "SECRET" },
  },
  claimedBy: null,
  claimedAt: null,
  claimExpiresAt: null,
  ...overrides,
});

const PAGE_KEYS = [
  "breakdown",
  "counts",
  "events",
  "pagination",
  "sectionErrors",
  "services",
  "sourceErrors",
  "statuses",
];

// Every seeded row carries a `PAGE-…` segregationRef and `q` matches that as a
// case-insensitive prefix, so the assertions below are scoped to the rows the
// test seeded. The containerised GAS keeps its pollers running, and a row one
// of them writes between the cleanup and the request would otherwise land in
// an unscoped count.
const SCOPE = "q=PAGE-";

const eventsPage = async (query = "", options = {}) => {
  const { payload } = await wreck.get(
    `/grant-admin/events/page${query}`,
    options,
  );

  return payload;
};

describe("GET /grant-admin/events/page", () => {
  it("answers with every section in one read", async () => {
    await inbox.insertMany([inboxDoc(1), deadInboxDoc(2)]);
    await outbox.insertOne(outboxDoc(3));

    const body = await eventsPage(`?${SCOPE}`);

    expect(Object.keys(body).sort()).toEqual(PAGE_KEYS);
    expect(body.events).toHaveLength(3);
    expect(body.counts.COMPLETED).toBe(2);
    expect(body.counts.DEAD_LETTER).toBe(1);
    expect(body.breakdown.groups).toEqual([
      {
        error: "No handler found",
        type: "case.status.updated",
        count: 1,
        firstAt: at(2),
        lastAt: at(2),
      },
    ]);
    expect(body.sourceErrors).toEqual([]);
    expect(body.sectionErrors).toEqual([]);
    expect(eventsPageResponseSchema.validate(body).error).toBeUndefined();
  });

  // Read under `service=gas`, which reads no Caseworking source at all: the
  // vocabularies are constants of the API rather than reads that can fail, so
  // they ride a page whatever it managed to read.
  it("states the status vocabulary in the order a message travels", async () => {
    const { statuses, counts } = await eventsPage(`?${SCOPE}&service=gas`);

    expect(statuses.map((status) => status.value)).toEqual([
      "PUBLISHED",
      "PROCESSING",
      "FAILED",
      "RESUBMITTED",
      "COMPLETED",
      "DEAD_LETTER",
    ]);
    expect(statuses).toContainEqual({
      value: "DEAD_LETTER",
      label: "Dead letter",
      explainer: "Failed all retry attempts; needs a redrive",
    });
    // Every status the counts are keyed by has a chip to hang its figure on.
    expect(statuses.map((status) => status.value).sort()).toEqual(
      Object.keys(counts).sort(),
    );
  });

  it("states the services this platform runs, in full names", async () => {
    const { services } = await eventsPage(`?${SCOPE}&service=gas`);

    expect(services).toEqual([
      { value: "gas", label: "GAS" },
      { value: "caseworking", label: "Caseworking" },
    ]);
  });

  it("answers with an empty page, zeros and no groups when nothing matches", async () => {
    const body = await eventsPage("?q=MATCHES-NOTHING");

    expect(body.events).toEqual([]);
    expect(body.pagination).toEqual({
      startCursor: null,
      endCursor: null,
      hasNextPage: false,
      hasPreviousPage: false,
    });
    expect(Object.values(body.counts).every((n) => n === 0)).toBe(true);
    expect(body.breakdown).toEqual({ groups: [], sourceErrors: [] });
    expect(body.sectionErrors).toEqual([]);
  });

  // GAS reads the breakdown either way, so the frontend's decision about when
  // to draw the panel never costs a second round trip.
  it("reads the breakdown whether or not a status is selected", async () => {
    await inbox.insertOne(deadInboxDoc(1));

    expect((await eventsPage(`?${SCOPE}`)).breakdown.groups).toHaveLength(1);
    expect(
      (await eventsPage(`?${SCOPE}&status=DEAD_LETTER`)).breakdown.groups,
    ).toHaveLength(1);
    expect(
      (await eventsPage(`?${SCOPE}&status=COMPLETED`)).breakdown.groups,
    ).toHaveLength(1);
  });

  it("reads Caseworking exactly once for a whole page", async () => {
    await eventsPage();

    expect((await cwStubRequests()).map((r) => r.path)).toEqual([
      "/actuators/events",
    ]);
  });

  it("carries both boxes' cursors and the page's filters on it", async () => {
    await eventsPage(`?${SCOPE}&status=DEAD_LETTER&audit=include`);

    const [request] = await cwStubRequests();

    expect(request.query).toMatchObject({
      pageSize: "20",
      direction: "forward",
      status: "DEAD_LETTER",
      audit: "include",
    });
  });

  it("reads Caseworking not at all when the page is filtered to GAS", async () => {
    await eventsPage(`?${SCOPE}&service=gas`);

    expect(await cwStubRequests()).toEqual([]);
  });

  it("filters the list by status while the counts still describe every status", async () => {
    await inbox.insertMany([inboxDoc(1), deadInboxDoc(2)]);

    const body = await eventsPage(`?${SCOPE}&status=DEAD_LETTER&service=gas`);

    expect(body.events.map((event) => event.status)).toEqual(["DEAD_LETTER"]);
    expect(body.counts.COMPLETED).toBe(1);
    expect(body.counts.DEAD_LETTER).toBe(1);
  });

  it("never leaks an event payload into any section", async () => {
    await inbox.insertOne(deadInboxDoc(1));
    await outbox.insertOne(outboxDoc(2));

    const serialised = JSON.stringify(await eventsPage(`?${SCOPE}`));

    expect(serialised).not.toContain("SECRET");
    expect(serialised).not.toContain('"event"');
  });

  it("is not read as an event id by the detail route", async () => {
    const body = await eventsPage();

    expect(body).toHaveProperty("counts");
    expect(body).not.toHaveProperty("payload");
  });

  it("401s without a valid service bearer token", async () => {
    await expect(
      eventsPage("", {
        headers: {
          authorization: "Bearer 11111111-1111-1111-1111-111111111111",
        },
      }),
    ).rejects.toMatchObject({ output: { statusCode: 401 } });
  });

  it.each([
    ["a status outside the six", "?status=BOGUS"],
    ["a service outside the two", "?service=other"],
    ["a direction outside the two", "?direction=sideways"],
    ["a page size the list never had", "?pageSize=50"],
    ["the kind filter that no longer exists", "?kind=audit"],
    ["a reversed range", `?from=${at(30)}&to=${at(10)}`],
  ])("400s on %s", async (_name, query) => {
    await expect(eventsPage(query)).rejects.toMatchObject({
      output: { statusCode: 400 },
    });
  });

  it("400s on a tampered cursor", async () => {
    await expect(eventsPage("?cursor=not-a-cursor")).rejects.toMatchObject({
      output: { statusCode: 400 },
    });
  });
});

describe("GET /grant-admin/events/page with a broken Caseworking", () => {
  // Only a section that fails OUTRIGHT becomes a null and a sectionError, and
  // no CW failure can do that - the fan-out inside each section swallows it
  // into sourceErrors instead. An unreachable Caseworking is both boxes gone,
  // since one connection carries both.
  it("degrades every section to a partial answer, and says so in sourceErrors", async () => {
    await inbox.insertMany([inboxDoc(1), deadInboxDoc(2)]);
    await setCwStub({ inbox: { mode: "down" } });

    const body = await eventsPage(`?${SCOPE}`);

    expect(body.events).toHaveLength(2);
    expect(body.counts.DEAD_LETTER).toBe(1);
    expect(body.breakdown.groups).toHaveLength(1);
    expect(
      body.sourceErrors.map(({ service, box, hop }) => ({
        service,
        box,
        hop,
      })),
    ).toEqual([
      { service: "caseworking", box: "inbox", hop: "CW Inbox" },
      { service: "caseworking", box: "outbox", hop: "CW Outbox" },
    ]);
    expect(body.breakdown.sourceErrors).toEqual(body.sourceErrors);
    expect(body.counts).not.toBeNull();
    expect(body.sectionErrors).toEqual([]);
    expect(eventsPageResponseSchema.validate(body).error).toBeUndefined();
  });

  // Caseworking degrades per section inside its one answer: a box it could
  // not read comes back null, and only that box is named.
  it("names only the box Caseworking could not read", async () => {
    await inbox.insertOne(inboxDoc(1));
    await setCwStub({ outbox: { mode: "unreadable" } });

    const body = await eventsPage(`?${SCOPE}`);

    expect(body.events).toHaveLength(1);
    expect(body.sourceErrors.map(({ box }) => box)).toEqual(["outbox"]);
    expect(body.sectionErrors).toEqual([]);
    expect(eventsPageResponseSchema.validate(body).error).toBeUndefined();
  });

  it("never leaks a Caseworking response body into any error on the page", async () => {
    await setCwStub({ inbox: { mode: "unauthorized" } });

    const body = await eventsPage();

    expect(JSON.stringify(body)).not.toContain("SECRET-CW-401-BODY");
    expect(body.sourceErrors[0].message).toBe("HTTP 401");
  });

  it("reports no Caseworking failure under service=gas, which does not read it", async () => {
    await inbox.insertOne(inboxDoc(1));
    await setCwStub({ inbox: { mode: "down" }, outbox: { mode: "down" } });

    const body = await eventsPage(`?${SCOPE}&service=gas`);

    expect(body.sourceErrors).toEqual([]);
    expect(body.breakdown.sourceErrors).toEqual([]);
    expect(body.sectionErrors).toEqual([]);
    expect(await cwStubRequests()).toEqual([]);
  });
});

describe("the events page replaced three endpoints", () => {
  it.each(["/grant-admin/events/counts", "/grant-admin/events/breakdown"])(
    "404s on %s, which is a section of the page now",
    async (path) => {
      await expect(wreck.get(path)).rejects.toMatchObject({
        output: { statusCode: 404 },
      });
    },
  );

  // The list endpoint stays: the detail and redrive flows read it.
  it("still answers on GET /grant-admin/events", async () => {
    await inbox.insertOne(inboxDoc(1));

    const { payload } = await wreck.get(`/grant-admin/events?${SCOPE}`);

    expect(payload.events).toHaveLength(1);
    expect(Object.keys(payload).sort()).toEqual([
      "events",
      "pagination",
      "sourceErrors",
    ]);
  });

  it("answers with exactly what the list endpoint answers, in its three keys", async () => {
    await inbox.insertMany([inboxDoc(1), deadInboxDoc(2)]);
    await outbox.insertOne(outboxDoc(3));

    const page = await eventsPage(`?${SCOPE}`);
    const { payload: list } = await wreck.get(`/grant-admin/events?${SCOPE}`);

    expect(page.events).toEqual(list.events);
    expect(page.pagination).toEqual(list.pagination);
    expect(page.sourceErrors).toEqual(list.sourceErrors);
  });
});

describe("swagger", () => {
  it("documents GET /grant-admin/events/page with its composed response schema", async () => {
    const { payload } = await wreck.get("/swagger.json");

    expect(Object.keys(payload.paths)).toContain("/grant-admin/events/page");
    expect(
      JSON.stringify(payload.paths["/grant-admin/events/page"].get.responses),
    ).toContain("EventsPageResponse");
    expect(Object.keys(payload.definitions)).toEqual(
      expect.arrayContaining([
        "EventsPageResponse",
        "EventStatusCounts",
        "EventBreakdownGroup",
        "EventSectionError",
      ]),
    );
  });

  it("no longer documents the counts and breakdown endpoints", async () => {
    const { payload } = await wreck.get("/swagger.json");

    expect(Object.keys(payload.paths)).not.toContain(
      "/grant-admin/events/counts",
    );
    expect(Object.keys(payload.paths)).not.toContain(
      "/grant-admin/events/breakdown",
    );
  });
});

// Regression: a `?q=` filter is a bare `$or`, and so is the keyset clause the
// pager adds - merged by spread, one silently replaces the other, making every
// page after the first the whole collection. They must be composed under
// `$and`. The endpoint takes no `pageSize` (fixed 20), so the seed fills a
// page: 21 matching rows interleaved with 21 that do not, exactly the
// arrangement an unfiltered second page would expose.
describe("paging a search keeps the search", () => {
  const NEEDLE = "PAGEOR";
  const RUN = 21;

  // The counts tests count whatever is in the collections without a filter of
  // their own, so everything seeded here is cleared again.
  afterEach(async () => {
    const seeded = { segregationRef: /^(PAGEOR|OTHER)-/ };

    await Promise.all([inbox.deleteMany(seeded), outbox.deleteMany(seeded)]);
  });

  const interleaved = (build) =>
    Array.from({ length: RUN }, (_, i) => [
      build(i * 2, `${NEEDLE}-${i}`),
      build(i * 2 + 1, `OTHER-${i}`),
    ]).flat();

  // The searched reference is not on the row, so each row carries it in its
  // event id instead.
  const matched = (rows) => rows.every((row) => row.eventId.includes(NEEDLE));

  it("returns only matching rows on the page after the first", async () => {
    await inbox.insertMany(
      interleaved((n, ref) =>
        inboxDoc(n, { messageId: `msg-${ref}`, segregationRef: ref }),
      ),
    );

    const first = await eventsPage(`?q=${NEEDLE}`);

    expect(first.events).toHaveLength(20);
    expect(matched(first.events)).toBe(true);
    expect(first.pagination.hasNextPage).toBe(true);

    const second = await eventsPage(
      `?q=${NEEDLE}&cursor=${encodeURIComponent(
        first.pagination.endCursor,
      )}&direction=forward`,
    );

    expect(second.events).not.toHaveLength(0);
    expect(matched(second.events)).toBe(true);
    expect(second.events.map((row) => row.id)).not.toEqual(
      first.events.map((row) => row.id),
    );
  });

  it("walks backward through a search without losing the filter", async () => {
    await inbox.insertMany(
      interleaved((n, ref) =>
        inboxDoc(n, { messageId: `msg-${ref}`, segregationRef: ref }),
      ),
    );

    const first = await eventsPage(`?q=${NEEDLE}`);
    const second = await eventsPage(
      `?q=${NEEDLE}&cursor=${encodeURIComponent(
        first.pagination.endCursor,
      )}&direction=forward`,
    );
    const back = await eventsPage(
      `?q=${NEEDLE}&cursor=${encodeURIComponent(
        second.pagination.startCursor,
      )}&direction=backward`,
    );

    expect(back.events).not.toHaveLength(0);
    expect(matched(back.events)).toBe(true);
  });

  it("keeps an outbox search filtered on its second page too", async () => {
    await outbox.insertMany(
      interleaved((n, ref) =>
        outboxDoc(n, {
          segregationRef: ref,
          event: { ...outboxDoc(n).event, id: `evt-${ref}` },
        }),
      ),
    );

    const first = await eventsPage(`?q=${NEEDLE}`);
    const second = await eventsPage(
      `?q=${NEEDLE}&cursor=${encodeURIComponent(
        first.pagination.endCursor,
      )}&direction=forward`,
    );

    expect(second.events).not.toHaveLength(0);
    expect(matched(second.events)).toBe(true);
  });
});

describe("GET /grant-admin/events/page audit records", () => {
  const REF = "AUDITPAGE";
  const SCOPED = `q=${REF}`;

  // The topic write-audit-event.js addresses, and what the integration env
  // sets for GAS__SNS__AUDIT_TOPIC_ARN.
  const AUDIT_ARN =
    "arn:aws:sns:eu-west-2:000000000000:gas__sns__audit_topic_arn";

  const auditDoc = (n, overrides = {}) =>
    outboxDoc(n, {
      segregationRef: `${REF}-${n}`,
      target: AUDIT_ARN,
      event: {
        datetime: at(n),
        correlationid: "corr-1",
        audit: { entities: [{ entity: "APPLICATION", action: "VIEW" }] },
      },
      ...overrides,
    });

  const domainDoc = (n, overrides = {}) =>
    outboxDoc(n, { segregationRef: `${REF}-${n}`, ...overrides });

  // No type and NOT addressed at the audit topic: "unknown", never filtered
  // off a default page.
  const unknownDoc = (n) =>
    outboxDoc(n, {
      segregationRef: `${REF}-${n}`,
      event: { id: `evt-unknown-${n}`, time: at(n), data: {} },
    });

  const deadAudit = (n) =>
    auditDoc(n, {
      status: "DEAD_LETTER",
      completionDate: null,
      completionAttempts: 5,
      lastError: { name: "Error", message: "audit publish failed", at: at(n) },
    });

  const deadDomain = (n) =>
    domainDoc(n, {
      status: "DEAD_LETTER",
      completionDate: null,
      completionAttempts: 5,
      lastError: { name: "Error", message: "publish failed", at: at(n) },
    });

  it("labels an audit row rather than leaving a gap", async () => {
    await outbox.insertOne(auditDoc(1));

    const [row] = (await eventsPage(`?${SCOPED}&audit=include`)).events;

    expect(row.type).toBe("audit");
    expect(row.queue).toBe("to Audit");
    expect(row).not.toHaveProperty("fullType");
  });

  // The branch most easily lost: the label and the filter narrow TOGETHER.
  it("names a type-less non-audit row unknown and keeps it on a default page", async () => {
    await outbox.insertMany([unknownDoc(1), auditDoc(2)]);

    const body = await eventsPage(`?${SCOPED}`);

    expect(body.events.map((event) => event.type)).toEqual(["unknown"]);
    expect(body.events[0]).not.toHaveProperty("fullType");
  });

  it("leaves audit records out of the rows, the counts AND the breakdown by default", async () => {
    await outbox.insertMany([deadDomain(1), deadAudit(2), auditDoc(3)]);

    const body = await eventsPage(`?${SCOPED}`);

    expect(body.events.map((event) => event.type)).toEqual(["case.create"]);
    expect(body.counts.DEAD_LETTER).toBe(1);
    expect(body.counts.COMPLETED).toBe(0);
    expect(body.breakdown.groups.map((group) => group.type)).toEqual([
      "case.create",
    ]);
  });

  // Both group under a null stored type, and they are not the same population.
  it("keeps the audit and unknown breakdown groups apart", async () => {
    await outbox.insertMany([
      deadAudit(1),
      outboxDoc(2, {
        segregationRef: `${REF}-2`,
        status: "DEAD_LETTER",
        completionDate: null,
        completionAttempts: 5,
        lastError: {
          name: "Error",
          message: "audit publish failed",
          at: at(2),
        },
        event: { id: "evt-unknown-2", time: at(2), data: {} },
      }),
    ]);

    const body = await eventsPage(`?${SCOPED}&audit=include`);

    expect(body.breakdown.groups.map((group) => group.type).sort()).toEqual([
      "audit",
      "unknown",
    ]);
  });

  it("includes them in the rows, the counts AND the breakdown on request", async () => {
    await outbox.insertMany([deadDomain(1), deadAudit(2), auditDoc(3)]);

    const body = await eventsPage(`?${SCOPED}&audit=include`);

    expect(body.events).toHaveLength(3);
    expect(body.counts.DEAD_LETTER).toBe(2);
    expect(body.counts.COMPLETED).toBe(1);
    expect(body.breakdown.groups.map((group) => group.type).sort()).toEqual([
      "audit",
      "case.create",
    ]);
  });

  it.each(["exclude", "include"])(
    "counts exactly the rows it lists with audit=%s",
    async (audit) => {
      await outbox.insertMany([domainDoc(1), auditDoc(2), auditDoc(3)]);

      const body = await eventsPage(`?${SCOPED}&audit=${audit}`);
      const total = Object.values(body.counts).reduce((sum, n) => sum + n, 0);

      expect(total).toBe(body.events.length);
    },
  );

  // The breakdown group and the rows it counts must read the same string.
  it("keys the audit breakdown group the same way it labels the rows", async () => {
    await outbox.insertMany([deadAudit(1), deadAudit(2)]);

    const body = await eventsPage(`?${SCOPED}&audit=include`);
    const [group] = body.breakdown.groups;

    expect(group).toMatchObject({ type: "audit", count: 2 });
    expect(body.events.every((event) => event.type === group.type)).toBe(true);
  });

  it.each([
    ["an audit mode outside the two", "?audit=all"],
    ["an empty audit mode", "?audit="],
  ])("400s on %s", async (_name, query) => {
    await expect(eventsPage(query)).rejects.toMatchObject({
      output: { statusCode: 400 },
    });
  });

  // Nothing is hidden, only kept off a default list: an audit event's own page
  // is reachable by id, and its journey is not filtered either.
  it("still resolves an audit event's detail page by id while the list omits it", async () => {
    const { insertedId } = await outbox.insertOne(auditDoc(1));
    const id = insertedId.toString();

    expect((await eventsPage(`?${SCOPED}`)).events).toEqual([]);

    const { payload: detail } = await wreck.get(
      `/grant-admin/events/gas/outbox/${id}`,
    );

    expect(detail.id).toBe(id);
    expect(detail.type).toBe("audit");
    expect(detail.typeTitle).toBe("Audit record — not a CloudEvent");
    expect(detail.journey.map((hop) => hop.id)).toEqual([id]);
    expect(detail.sectionErrors).toEqual([]);
  });
});
