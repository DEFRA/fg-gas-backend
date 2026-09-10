import { MongoClient } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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

const ZERO = {
  PUBLISHED: 0,
  PROCESSING: 0,
  FAILED: 0,
  RESUBMITTED: 0,
  COMPLETED: 0,
  DEAD_LETTER: 0,
};

const counts = (overrides = {}) => ({ ...ZERO, ...overrides });

// Only statuses the running pollers leave alone: PUBLISHED, FAILED and
// RESUBMITTED rows are rewritten mid-test by the claim and resubmit sweeps.
const at = (minute) =>
  new Date(Date.UTC(2026, 5, 16, 10, minute)).toISOString();

const inboxDoc = (n, overrides = {}) => ({
  messageId: `msg-count-${n}`,
  type: "cloud.defra.local.fg-cw-backend.case.status.updated",
  source: "CW",
  status: "COMPLETED",
  completionAttempts: 1,
  eventTime: at(n),
  publicationDate: at(n),
  lastResubmissionDate: null,
  completionDate: at(n),
  segregationRef: `COUNT-${n}`,
  event: { id: `evt-count-${n}`, time: at(n), data: { clientRef: "REF" } },
  claimedBy: null,
  claimedAt: null,
  claimExpiresAt: null,
  ...overrides,
});

const outboxDoc = (n, overrides = {}) => ({
  target:
    "arn:aws:sns:eu-west-2:000000000000:gas__sns__create_new_case_fifo.fifo",
  status: "COMPLETED",
  completionAttempts: 1,
  publicationDate: new Date(Date.UTC(2026, 5, 16, 10, n)),
  lastResubmissionDate: null,
  completionDate: at(n),
  segregationRef: `COUNT-${n}`,
  event: {
    id: `evt-count-${n}`,
    type: "cloud.defra.local.fg-gas-backend.case.create",
    time: at(n),
    data: { clientRef: "REF" },
  },
  claimedBy: null,
  claimedAt: null,
  claimExpiresAt: null,
  ...overrides,
});

// The counts are a section of the events page, so these read the page and
// look at `counts` on it. A source the counts could not read is named in the
// page's own `sourceErrors` rather than a second time inside the section.
const countEvents = async (query = "", options = {}) => {
  const { payload } = await wreck.get(
    `/grant-admin/events/page${query}`,
    options,
  );

  return payload;
};

const findEvents = async (query = "") => {
  const { payload } = await wreck.get(`/grant-admin/events${query}`);

  return payload;
};

// Matches the ARN the integration environment configures.
const AUDIT_ARN =
  "arn:aws:sns:eu-west-2:000000000000:gas__sns__audit_topic_arn";

// The three shapes a row that looks audit-ish can take. Only the DESTINATION
// makes one an audit record (see events/event-audit.js): `auditByPayload`
// merely carries an `audit` key and is an ordinary row.
const auditByPayload = (n) =>
  outboxDoc(n, { event: { ...outboxDoc(n).event, audit: { action: "VIEW" } } });

const auditByTarget = (n) => outboxDoc(n, { target: AUDIT_ARN });

const auditByBoth = (n) =>
  outboxDoc(n, {
    target: AUDIT_ARN,
    event: { ...outboxDoc(n).event, audit: { action: "VIEW" } },
  });

// Two GAS domain rows (one inbox, one outbox) and three GAS audit rows, one of
// each shape. Caseworking's numbers come from the stub.
const seedMixedGas = async () => {
  await inbox.insertMany([inboxDoc(1), inboxDoc(2, { status: "DEAD_LETTER" })]);
  await outbox.insertMany([
    outboxDoc(3),
    auditByPayload(4),
    auditByTarget(5),
    auditByBoth(6),
  ]);
};

const totalOf = (body) =>
  Object.values(body.counts).reduce((sum, n) => sum + n, 0);

describe("GET /grant-admin/events/page - the counts section", () => {
  it("answers with every status at zero for an empty estate", async () => {
    const body = await countEvents();

    expect(body.counts).toEqual(ZERO);
    expect(body.sourceErrors).toEqual([]);
    expect(body.sectionErrors).toEqual([]);
    expect(eventsPageResponseSchema.validate(body).error).toBeUndefined();
  });

  it("is not read as an event id by the detail route", async () => {
    const body = await countEvents();

    expect(body).toHaveProperty("counts");
    expect(body).not.toHaveProperty("payload");
  });

  it("counts GAS inbox and outbox rows per status", async () => {
    await inbox.insertMany([
      inboxDoc(1),
      inboxDoc(2),
      inboxDoc(3, { status: "DEAD_LETTER" }),
    ]);
    await outbox.insertMany([
      outboxDoc(4, { status: "DEAD_LETTER" }),
      outboxDoc(5, { status: "PROCESSING", claimExpiresAt: new Date(2099, 0) }),
    ]);

    expect((await countEvents()).counts).toEqual(
      counts({ COMPLETED: 2, DEAD_LETTER: 2, PROCESSING: 1 }),
    );
  });

  it("sums GAS and Caseworking into one set of counts", async () => {
    await inbox.insertOne(inboxDoc(1));
    await setCwStub({
      inbox: { counts: counts({ DEAD_LETTER: 3 }) },
      outbox: { counts: counts({ COMPLETED: 7, FAILED: 1 }) },
    });

    expect((await countEvents()).counts).toEqual(
      counts({ COMPLETED: 8, DEAD_LETTER: 3, FAILED: 1 }),
    );
  });

  it("counts only GAS with service=gas, and never reads Caseworking", async () => {
    await inbox.insertOne(inboxDoc(1));
    await setCwStub({ inbox: { counts: counts({ DEAD_LETTER: 3 }) } });

    const body = await countEvents("?service=gas");

    expect(body.counts).toEqual(counts({ COMPLETED: 1 }));
    expect(totalOf(body)).toBe(1);
    expect(await cwStubRequests()).toEqual([]);
  });

  it("counts only Caseworking with service=caseworking", async () => {
    await inbox.insertOne(inboxDoc(1));
    await setCwStub({ inbox: { counts: counts({ DEAD_LETTER: 3 }) } });

    expect((await countEvents("?service=caseworking")).counts).toEqual(
      counts({ DEAD_LETTER: 3 }),
    );
  });

  it("applies q to both services", async () => {
    await inbox.insertMany([inboxDoc(1), inboxDoc(2)]);

    const body = await countEvents("?q=COUNT-1");

    expect(body.counts).toEqual(counts({ COMPLETED: 1 }));

    expect((await cwStubRequests()).map((request) => request.query.q)).toEqual([
      "COUNT-1",
    ]);
  });

  it("applies from and to, and forwards them to Caseworking", async () => {
    await inbox.insertMany([inboxDoc(10), inboxDoc(20), inboxDoc(30)]);
    await outbox.insertOne(outboxDoc(15));

    const body = await countEvents(`?from=${at(15)}&to=${at(25)}`);

    expect(body.counts).toEqual(counts({ COMPLETED: 2 }));

    const [request] = await cwStubRequests();

    expect(request.query.from).toBe(at(15));
    expect(request.query.to).toBe(at(25));
  });

  it("takes its Caseworking numbers from the page's one call, with the bearer token", async () => {
    await countEvents();

    const requests = await cwStubRequests();

    expect(requests.map((request) => request.path)).toEqual([
      "/actuators/events",
    ]);
    expect(requests[0].authorization).toBe("Bearer cw-stub-token");
  });

  it("contributes zeros and a sourceError for both boxes when Caseworking is down", async () => {
    await inbox.insertOne(inboxDoc(1));
    await setCwStub({ inbox: { mode: "down" } });
    // a destroyed socket surfaces as wreck's own 502

    const body = await countEvents();

    expect(body.counts).toEqual(counts({ COMPLETED: 1 }));
    expect(body.sourceErrors).toEqual([
      {
        service: "caseworking",
        box: "inbox",
        hop: "CW Inbox",
        message: "HTTP 502",
      },
      {
        service: "caseworking",
        box: "outbox",
        hop: "CW Outbox",
        message: "HTTP 502",
      },
    ]);
    // A source that could not be read is not a section that could not be read:
    // the counts still answer, with the numbers they could get.
    expect(body.sectionErrors).toEqual([]);
    expect(eventsPageResponseSchema.validate(body).error).toBeUndefined();
  });

  it("never leaks a Caseworking response body into a sourceError", async () => {
    await setCwStub({ inbox: { mode: "unauthorized" } });

    const body = await countEvents();

    expect(JSON.stringify(body)).not.toContain("SECRET-CW-401-BODY");
    expect(body.sourceErrors[0].message).toBe("HTTP 401");
  });

  // `status` filters the list beside the counts and never reaches them:
  // counting per status is what they are for.
  it("counts every status whatever status the list is filtered to", async () => {
    await inbox.insertMany([
      inboxDoc(1),
      inboxDoc(2, { status: "DEAD_LETTER" }),
    ]);

    const body = await countEvents("?status=DEAD_LETTER&service=gas");

    expect(body.counts).toEqual(counts({ COMPLETED: 1, DEAD_LETTER: 1 }));
    expect(body.events).toHaveLength(1);
  });

  it("400s on from after to", async () => {
    await expect(countEvents(`?from=${at(30)}&to=${at(10)}`)).rejects.toThrow(
      "Response Error: 400 Bad Request",
    );
  });

  it("401s without a valid service bearer token", async () => {
    await expect(
      countEvents("", {
        headers: {
          authorization: "Bearer 11111111-1111-1111-1111-111111111111",
        },
      }),
    ).rejects.toMatchObject({ output: { statusCode: 401 } });
  });
});

// ---------------------------------------------------------------------------
// The three facets. Each block is computed with its OWN filter excluded and
// every other filter applied, so a selected segment in the frontend's filter
// bar still shows its siblings' true numbers.
// ---------------------------------------------------------------------------

describe("GET /grant-admin/events/page - the counts facet", () => {
  it("counts every source it read when nothing is filtered", async () => {
    await seedMixedGas();
    await setCwStub({
      inbox: { counts: counts({ DEAD_LETTER: 3 }) },
      outbox: { counts: counts({ COMPLETED: 5 }) },
    });

    const body = await countEvents("?audit=include");

    expect(totalOf(body)).toBe(14);
    expect(eventsPageResponseSchema.validate(body).error).toBeUndefined();
  });

  // A `total` sent beside the six numbers could only ever agree with them or
  // be a bug; the caller adds them up.
  it("carries the six numbers and nothing else", async () => {
    await seedMixedGas();

    const body = await countEvents();

    expect(body.counts).not.toHaveProperty("total");
    expect(body.counts).not.toHaveProperty("byService");
    expect(body.counts).not.toHaveProperty("byKind");
    expect(Object.keys(body.counts).sort()).toEqual([
      "COMPLETED",
      "DEAD_LETTER",
      "FAILED",
      "PROCESSING",
      "PUBLISHED",
      "RESUBMITTED",
    ]);
  });

  it.each([
    ["kind=audit", "?kind=audit"],
    ["kind=domain", "?service=gas&kind=domain"],
    ["an unknown kind", "?kind=other"],
    ["an empty kind", "?kind="],
  ])("responds 400 for %s", async (_name, query) => {
    await expect(countEvents(query)).rejects.toMatchObject({
      output: { statusCode: 400 },
    });
  });

  it("counts audit rows into the status counts like any other row", async () => {
    await seedMixedGas();

    const body = await countEvents("?service=gas&audit=include");

    expect(body.counts).toEqual(counts({ COMPLETED: 5, DEAD_LETTER: 1 }));
    expect(totalOf(body)).toBe(6);
  });

  it("narrows the counts by q and by the time range", async () => {
    await inbox.insertMany([inboxDoc(10), inboxDoc(20)]);
    await outbox.insertMany([auditByPayload(15), auditByTarget(30)]);

    expect(totalOf(await countEvents("?service=gas&q=COUNT-10"))).toBe(1);
    expect(
      totalOf(await countEvents(`?service=gas&from=${at(12)}&to=${at(25)}`)),
    ).toBe(2);
  });

  it("counts exactly the rows the list returns, on all three audit shapes", async () => {
    await seedMixedGas();

    const body = await countEvents("?service=gas");
    const listed = await findEvents("?service=gas");

    expect(totalOf(body)).toBe(listed.events.length);
  });

  it("counts both Caseworking boxes off ONE call, with no kind on it", async () => {
    await countEvents("?q=GLD-9B2");

    const requests = await cwStubRequests();

    expect(requests).toHaveLength(1);
    expect(requests[0].path).toBe("/actuators/events");
    expect(requests[0].query).not.toHaveProperty("kind");
  });

  it("forwards the error filter to Caseworking on that one call", async () => {
    await countEvents("?error=boom");

    const [request] = await cwStubRequests();

    expect(request.query.error).toBe("boom");
  });

  it("contributes zeros when Caseworking answers 500, and says so for both boxes", async () => {
    await seedMixedGas();
    await setCwStub({ outbox: { mode: "error" } });

    const body = await countEvents("?audit=include");

    expect(totalOf(body)).toBe(6);
    expect(body.sourceErrors).toEqual([
      {
        service: "caseworking",
        box: "inbox",
        hop: "CW Inbox",
        message: "HTTP 500",
      },
      {
        service: "caseworking",
        box: "outbox",
        hop: "CW Outbox",
        message: "HTTP 500",
      },
    ]);
    expect(eventsPageResponseSchema.validate(body).error).toBeUndefined();
  });

  it("counts the box Caseworking could read and names only the one it could not", async () => {
    await inbox.insertOne(inboxDoc(1));
    await setCwStub({
      inbox: { counts: counts({ DEAD_LETTER: 3 }) },
      outbox: { mode: "unreadable" },
    });

    const body = await countEvents();

    expect(body.counts).toEqual(counts({ COMPLETED: 1, DEAD_LETTER: 3 }));
    expect(body.sourceErrors).toEqual([
      {
        service: "caseworking",
        box: "outbox",
        hop: "CW Outbox",
        message: "HTTP 502",
      },
    ]);
    expect(body.sectionErrors).toEqual([]);
    expect(eventsPageResponseSchema.validate(body).error).toBeUndefined();
  });

  // Under `?service=gas` Caseworking is not part of the answer, so a broken
  // Caseworking is not a gap in it.
  it("reports no Caseworking failure under service=gas, which does not read it", async () => {
    await seedMixedGas();
    await setCwStub({ inbox: { mode: "down" }, outbox: { mode: "down" } });

    const body = await countEvents("?service=gas&audit=include");

    expect(totalOf(body)).toBe(6);
    expect(body.sourceErrors).toEqual([]);
  });

  // A box Caseworking read and found nothing in is six zeros, which is an
  // answer. A box it could NOT read is the `unreadable` case above.
  it("reads an empty Caseworking box as zeros, not as a failure", async () => {
    await setCwStub({ inbox: { counts: counts({ DEAD_LETTER: 4 }) } });

    const body = await countEvents();

    expect(body.counts).toEqual(counts({ DEAD_LETTER: 4 }));
    expect(body.sourceErrors).toEqual([]);
  });
});
