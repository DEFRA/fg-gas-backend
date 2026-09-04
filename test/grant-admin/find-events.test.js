import { MongoClient, ObjectId } from "mongodb";
import { env } from "node:process";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { findEventsResponseSchema } from "../../src/grant-admin/schemas/find-events-response.schema.js";
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

// The stub answers both actuator endpoints with an empty page unless a test
// says otherwise, so the GAS-only cases below see exactly what they seed.
beforeEach(async () => {
  await resetCwStub();
});

// The containerised GAS runs its inbox/outbox pollers every 250 ms and they
// rewrite PUBLISHED, FAILED and RESUBMITTED rows (claim, resubmit, dead-letter)
// while a test is running. Only terminal or untouched statuses are seeded here;
// status passthrough for the other three is covered by the unit tests.
const STABLE_STATUSES = ["COMPLETED", "DEAD_LETTER", "PROCESSING"];

// .env sets INBOX_MAX_RETRIES / OUTBOX_MAX_RETRIES to 5, and the container
// reads .env - not test/vitest.config.js, which only configures this process.
const GAS_MAX_ATTEMPTS = 5;

const at = (minute) =>
  new Date(Date.UTC(2026, 5, 16, 10, minute)).toISOString();

const inboxDoc = (n, overrides = {}) => ({
  messageId: `msg-${n}`,
  type: "cloud.defra.local.fg-cw-backend.case.status.updated",
  source: "CW",
  status: "COMPLETED",
  completionAttempts: 1,
  eventTime: at(n),
  publicationDate: new Date().toISOString(),
  lastResubmissionDate: null,
  completionDate: at(n),
  segregationRef: `GLD-9B2-BWS-${n}`,
  traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  event: { id: `evt-${n}`, time: at(n), data: { clientRef: "SECRET-REF" } },
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
  segregationRef: `GLD-9B2-BWS-${n}`,
  event: {
    id: `evt-${n}`,
    type: "cloud.defra.local.fg-gas-backend.case.create",
    time: at(n),
    traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    data: { clientRef: "SECRET-REF" },
  },
  claimedBy: null,
  claimedAt: null,
  claimExpiresAt: null,
  ...overrides,
});

const auditOutboxDoc = (n) =>
  outboxDoc(n, {
    target: "arn:aws:sns:eu-west-2:000000000000:gas__sns__audit_topic_arn",
    event: {
      datetime: at(n),
      correlationid: "corr-1",
      audit: {
        entities: [
          {
            entity: "APPLICATION",
            action: "SUBMIT_APPLICATION",
            entityid: "APP-SECRET-123",
          },
        ],
        details: { query: "SECRET-DETAILS" },
      },
    },
  });

const findEvents = async (query = "", options = {}) => {
  const { payload } = await wreck.get(`/grant-admin/events${query}`, options);

  return payload;
};

describe("GET /grant-admin/events", () => {
  it("returns every seeded row newest first with no filter", async () => {
    await inbox.insertMany([inboxDoc(1), inboxDoc(3)]);
    await outbox.insertMany([outboxDoc(2), outboxDoc(4)]);

    const body = await findEvents();

    expect(body.events).toHaveLength(4);
    expect(body.events.map((event) => event.createdAt)).toEqual([
      at(4),
      at(3),
      at(2),
      at(1),
    ]);
    expect(body.events.map((event) => `${event.service}/${event.box}`)).toEqual(
      ["gas/outbox", "gas/inbox", "gas/outbox", "gas/inbox"],
    );
  });

  it("returns rows of every stable status when no filter is given", async () => {
    await inbox.insertMany(
      STABLE_STATUSES.map((status, n) => inboxDoc(n, { status })),
    );
    await outbox.insertMany(
      STABLE_STATUSES.map((status, n) => outboxDoc(n + 10, { status })),
    );

    const body = await findEvents();

    expect(body.events).toHaveLength(6);
    expect(
      [...new Set(body.events.map((event) => event.status))].sort(),
    ).toEqual([...STABLE_STATUSES].sort());
  });

  it("returns exactly 20 rows and hasNextPage when 25 are seeded", async () => {
    await inbox.insertMany(
      Array.from({ length: 25 }, (_, n) => inboxDoc(n + 1)),
    );

    const body = await findEvents();

    expect(body.events).toHaveLength(20);
    expect(body.pagination.hasNextPage).toBe(true);
    expect(body.pagination.hasPreviousPage).toBe(false);
    expect(body.pagination.endCursor).toEqual(expect.any(String));
  });

  it("Next then Previous returns the first page's rows in the same order", async () => {
    await inbox.insertMany(
      Array.from({ length: 25 }, (_, n) => inboxDoc(n + 1)),
    );
    await outbox.insertMany(
      Array.from({ length: 25 }, (_, n) => outboxDoc(n + 1)),
    );

    const first = await findEvents();
    const second = await findEvents(
      `?cursor=${encodeURIComponent(first.pagination.endCursor)}&direction=forward`,
    );

    expect(second.pagination.hasPreviousPage).toBe(true);

    const back = await findEvents(
      `?cursor=${encodeURIComponent(second.pagination.startCursor)}&direction=backward`,
    );

    expect(back.events.map((event) => event.id)).toEqual(
      first.events.map((event) => event.id),
    );
  });

  it("a row inserted between two requests is neither duplicated nor skipped", async () => {
    await inbox.insertMany(
      Array.from({ length: 25 }, (_, n) => inboxDoc(n + 1)),
    );

    const first = await findEvents();

    await inbox.insertOne(
      inboxDoc(99, { eventTime: "2027-01-01T00:00:00.000Z" }),
    );

    const seen = [...first.events.map((event) => event.id)];
    let { endCursor, hasNextPage } = first.pagination;

    while (hasNextPage) {
      const page = await findEvents(
        `?cursor=${encodeURIComponent(endCursor)}&direction=forward`,
      );
      seen.push(...page.events.map((event) => event.id));
      endCursor = page.pagination.endCursor;
      hasNextPage = page.pagination.hasNextPage;
    }

    expect(new Set(seen).size).toEqual(seen.length);
    expect(seen).toHaveLength(25);
  });

  it("?status=DEAD_LETTER returns only dead-lettered rows from both boxes", async () => {
    await inbox.insertMany([
      inboxDoc(1, { status: "DEAD_LETTER" }),
      inboxDoc(2, { status: "COMPLETED" }),
    ]);
    await outbox.insertMany([
      outboxDoc(3, { status: "DEAD_LETTER" }),
      outboxDoc(4, { status: "COMPLETED" }),
    ]);

    const body = await findEvents("?status=DEAD_LETTER");

    expect(body.events).toHaveLength(2);
    expect(body.events.map((event) => event.box).sort()).toEqual([
      "inbox",
      "outbox",
    ]);
    expect(body.events.every((event) => event.status === "DEAD_LETTER")).toBe(
      true,
    );
  });

  it("?service=gas returns only GAS rows and reports no caseworking sourceErrors", async () => {
    await inbox.insertOne(inboxDoc(1));

    const body = await findEvents("?service=gas");

    expect(body.events).toHaveLength(1);
    expect(body.events[0].service).toEqual("gas");
    expect(body.sourceErrors).toEqual([]);
  });

  it("?status=BOGUS responds 400", async () => {
    await expect(findEvents("?status=BOGUS")).rejects.toMatchObject({
      output: { statusCode: 400 },
    });
  });

  it("?service=other responds 400", async () => {
    await expect(findEvents("?service=other")).rejects.toMatchObject({
      output: { statusCode: 400 },
    });
  });

  it("a tampered cursor responds 400 Cannot decode cursor", async () => {
    await expect(findEvents("?cursor=tampered")).rejects.toMatchObject({
      output: { statusCode: 400 },
      data: { payload: { message: "Cannot decode cursor" } },
    });
  });

  it("a cursor with an unknown version responds 400 Cannot decode cursor", async () => {
    const cursor = Buffer.from(
      JSON.stringify({ v: 2, gasInbox: null }),
    ).toString("base64url");

    await expect(
      findEvents(`?cursor=${encodeURIComponent(cursor)}`),
    ).rejects.toMatchObject({
      output: { statusCode: 400 },
      data: { payload: { message: "Cannot decode cursor" } },
    });
  });

  // An audit record is not a CloudEvent: it stores no `event.type` at all, so
  // both type fields are null. Nothing is synthesised from its entities.
  it("returns the audit outbox row with a null type, a null fullType and its _id as eventId", async () => {
    const { insertedIds } = await outbox.insertMany([auditOutboxDoc(1)]);

    const body = await findEvents();
    const [row] = body.events;

    expect(row.type).toBeNull();
    expect(row.fullType).toBeNull();
    expect(row.eventId).toEqual(insertedIds[0].toString());
    expect(row.target).toEqual("gas__sns__audit_topic_arn");
  });

  it("reduces internal:message-bus to internal and keeps a legacy io.onsite type whole", async () => {
    await outbox.insertMany([
      outboxDoc(1, {
        target: "internal:message-bus",
        event: { id: "evt-1", type: "io.onsite.agreement.status.updated" },
      }),
    ]);

    const [row] = (await findEvents()).events;

    expect(row.target).toEqual("internal");
    expect(row.type).toEqual("io.onsite.agreement.status.updated");
    expect(row.fullType).toEqual("io.onsite.agreement.status.updated");
  });

  it("falls back to the _id timestamp for an inbox row with no eventTime", async () => {
    const id = new ObjectId();
    await inbox.insertOne(inboxDoc(1, { _id: id, eventTime: null }));

    const [row] = (await findEvents()).events;

    expect(row.id).toEqual(id.toString());
    expect(row.createdAt).toEqual(id.getTimestamp().toISOString());
  });

  it("returns a row with an unrecognised status rather than failing the page", async () => {
    await inbox.insertMany([
      inboxDoc(1, { status: "SOMETHING_ELSE" }),
      inboxDoc(2),
    ]);

    const body = await findEvents();

    expect(body.events).toHaveLength(2);
    expect(body.events.map((event) => event.status)).toContain(
      "SOMETHING_ELSE",
    );
  });

  it("reports GAS maxAttempts from the service's own retry configuration", async () => {
    await inbox.insertOne(inboxDoc(1, { completionAttempts: 3 }));
    await outbox.insertOne(outboxDoc(2, { completionAttempts: 2 }));

    const body = await findEvents();

    expect(
      body.events.map((event) => [event.attempts, event.maxAttempts]),
    ).toEqual([
      [2, GAS_MAX_ATTEMPTS],
      [3, GAS_MAX_ATTEMPTS],
    ]);
  });

  it("derives traceId from a GAS inbox traceparent and a GAS outbox event.traceparent", async () => {
    await inbox.insertOne(inboxDoc(1));
    await outbox.insertOne(outboxDoc(2));

    const body = await findEvents();

    expect(body.events.map((event) => event.traceId)).toEqual([
      "4bf92f3577b34da6a3ce929d0e0e4736",
      "4bf92f3577b34da6a3ce929d0e0e4736",
    ]);
  });

  it("returns a bare CDP request id as the traceId unchanged", async () => {
    await inbox.insertOne(inboxDoc(1, { traceparent: "cdp-request-id-1" }));

    const [row] = (await findEvents()).events;

    expect(row.traceId).toEqual("cdp-request-id-1");
  });

  it("returns a null traceId when the document carries no traceparent", async () => {
    await inbox.insertOne(inboxDoc(1, { traceparent: null }));

    const [row] = (await findEvents()).events;

    expect(row.traceId).toBeNull();
  });

  it("returns a null traceId for an audit row and never its correlationid", async () => {
    await outbox.insertOne(auditOutboxDoc(1));

    const body = await findEvents();

    expect(body.events[0].traceId).toBeNull();
    expect(JSON.stringify(body)).not.toContain("corr-1");
  });

  it("returns no event, claimedBy, entityid, kind or full ARN anywhere in the payload", async () => {
    await inbox.insertOne(inboxDoc(1));
    await outbox.insertMany([outboxDoc(2), auditOutboxDoc(3)]);

    const serialised = JSON.stringify(await findEvents());

    for (const forbidden of [
      '"event"',
      "claimedBy",
      "entityid",
      '"kind"',
      "auditEntities",
      "arn:aws",
      "SECRET-REF",
      "APP-SECRET-123",
      "SECRET-DETAILS",
      "traceparent",
      "corr-1",
    ]) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it("returns the traceId and nothing else from the event that carried it", async () => {
    await outbox.insertOne(outboxDoc(1));

    const serialised = JSON.stringify(await findEvents());

    expect(serialised).toContain("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(serialised).not.toContain('"event"');
    expect(serialised).not.toContain("SECRET-REF");
  });

  it("an empty database returns an empty page with null cursors", async () => {
    const body = await findEvents();

    expect(body.events).toEqual([]);
    expect(body.pagination).toEqual({
      startCursor: null,
      endCursor: null,
      hasNextPage: false,
      hasPreviousPage: false,
    });
  });

  it("responds 401 without a service bearer token", async () => {
    await expect(
      wreck.get("/grant-admin/events", {
        headers: {
          authorization: "Bearer 11111111-1111-1111-1111-111111111111",
        },
      }),
    ).rejects.toMatchObject({ output: { statusCode: 401 } });
  });
});

describe("GET /grant-admin/events with Caseworking", () => {
  const cwRow = (n, overrides = {}) => ({
    _id: `665f1c2e9a1b2c3d4e5f${String(n).padStart(4, "0")}`,
    eventId: `cw-evt-${n}`,
    type: "cloud.defra.local.fg-cw-backend.case.status.updated",
    segregationRef: `CW-REF-${n}`,
    status: "COMPLETED",
    completionAttempts: 1,
    maxAttempts: 7,
    traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    createdAt: at(n),
    lastFailureAt: null,
    completedAt: at(n),
    ...overrides,
  });

  const cwInboxRow = (n, overrides) =>
    cwRow(n, { source: "GAS", ...overrides });

  const cwOutboxRow = (n, overrides) =>
    cwRow(n, {
      target: "arn:aws:sns:eu-west-2:000000000000:cw__sns__update_status",
      ...overrides,
    });

  it("merges Caseworking rows with GAS rows newest first", async () => {
    await inbox.insertOne(inboxDoc(1));
    await outbox.insertOne(outboxDoc(3));
    await setCwStub({
      inbox: { data: [cwInboxRow(2)] },
      outbox: { data: [cwOutboxRow(4)] },
    });

    const body = await findEvents();

    expect(body.sourceErrors).toEqual([]);
    expect(body.events.map((event) => `${event.service}/${event.box}`)).toEqual(
      ["caseworking/outbox", "gas/outbox", "caseworking/inbox", "gas/inbox"],
    );
    expect(body.events[0].target).toEqual("cw__sns__update_status");
    expect(body.events[0].maxAttempts).toEqual(7);
    expect(body.events.map((event) => event.traceId)).toEqual([
      "4bf92f3577b34da6a3ce929d0e0e4736",
      "4bf92f3577b34da6a3ce929d0e0e4736",
      "4bf92f3577b34da6a3ce929d0e0e4736",
      "4bf92f3577b34da6a3ce929d0e0e4736",
    ]);
  });

  it("derives traceId from the traceparent a Caseworking row arrives with", async () => {
    await setCwStub({ inbox: { data: [cwInboxRow(1)] } });

    const [row] = (await findEvents()).events;

    expect(row.traceId).toEqual("4bf92f3577b34da6a3ce929d0e0e4736");
  });

  it("returns a null traceId when a Caseworking row has no traceparent", async () => {
    await setCwStub({
      inbox: { data: [cwInboxRow(1, { traceparent: null })] },
    });

    const [row] = (await findEvents()).events;

    expect(row.traceId).toBeNull();
  });

  // An audit record is not a CloudEvent: it has no type, and none is invented
  // for it. The row goes through the same mapping as every other one.
  it("returns a null type for a Caseworking row that carries no type", async () => {
    await setCwStub({
      outbox: { data: [cwOutboxRow(1, { eventId: null, type: null })] },
    });

    const [row] = (await findEvents()).events;

    expect(row.type).toBeNull();
    expect(row.fullType).toBeNull();
    expect(row.eventId).toEqual("665f1c2e9a1b2c3d4e5f0001");
  });

  it("calls both actuators with the bearer token, pageSize 20, direction and the status filter", async () => {
    await findEvents("?status=DEAD_LETTER");

    const calls = await cwStubRequests();

    expect(calls.map((call) => call.path).sort()).toEqual([
      "/actuators/inbox",
      "/actuators/outbox",
    ]);
    for (const call of calls) {
      expect(call.authorization).toEqual("Bearer cw-stub-token");
      expect(call.query).toMatchObject({
        pageSize: "20",
        direction: "forward",
        status: "DEAD_LETTER",
      });
      expect(call.query).not.toHaveProperty("cursor");
    }
  });

  it("forwards the Caseworking slice of the composite cursor on the next page", async () => {
    await setCwStub({
      inbox: {
        data: [cwInboxRow(1)],
        pagination: {
          startCursor: null,
          endCursor: null,
          hasNextPage: true,
          hasPreviousPage: false,
        },
      },
    });

    const first = await findEvents();
    await resetCwStub();
    await findEvents(
      `?cursor=${encodeURIComponent(first.pagination.endCursor)}`,
    );

    const [inboxCall] = (await cwStubRequests()).filter(
      (call) => call.box === "inbox",
    );
    const slice = JSON.parse(
      Buffer.from(inboxCall.query.cursor, "base64url").toString(),
    );

    expect(slice).toEqual({
      eventTime: at(1),
      _id: "665f1c2e9a1b2c3d4e5f0001",
    });
  });

  it("?service=gas makes no Caseworking call at all", async () => {
    await inbox.insertOne(inboxDoc(1));
    await setCwStub({ inbox: { data: [cwInboxRow(2)] } });

    const body = await findEvents("?service=gas");

    expect(await cwStubRequests()).toEqual([]);
    expect(body.events.map((event) => event.service)).toEqual(["gas"]);
    expect(body.sourceErrors).toEqual([]);
  });

  it("?service=caseworking returns only Caseworking rows", async () => {
    await inbox.insertOne(inboxDoc(1));
    await setCwStub({ inbox: { data: [cwInboxRow(2)] } });

    const body = await findEvents("?service=caseworking");

    expect(body.events.map((event) => event.service)).toEqual(["caseworking"]);
    expect((await cwStubRequests()).map((call) => call.path).sort()).toEqual([
      "/actuators/inbox",
      "/actuators/outbox",
    ]);
  });

  it("a Caseworking 401 returns GAS rows with a sourceError and no response body anywhere", async () => {
    await inbox.insertOne(inboxDoc(1));
    await setCwStub({ inbox: { mode: "unauthorized" } });

    const body = await findEvents();

    expect(body.events).toHaveLength(1);
    expect(body.sourceErrors).toEqual([
      { service: "caseworking", box: "inbox", message: "HTTP 401" },
    ]);
    expect(JSON.stringify(body)).not.toContain("SECRET-CW-401-BODY");
  });

  it("a Caseworking 500 returns GAS rows with a sourceError", async () => {
    await inbox.insertOne(inboxDoc(1));
    await setCwStub({ outbox: { mode: "error" } });

    const body = await findEvents();

    expect(body.sourceErrors).toEqual([
      { service: "caseworking", box: "outbox", message: "HTTP 500" },
    ]);
    expect(JSON.stringify(body)).not.toContain("SECRET-CW-500-BODY");
  });

  it("a Caseworking connection failure returns GAS rows with a sourceError", async () => {
    await inbox.insertOne(inboxDoc(1));
    await setCwStub({ inbox: { mode: "down" }, outbox: { mode: "down" } });

    const body = await findEvents();

    expect(body.events).toHaveLength(1);
    expect(body.sourceErrors.map((error) => error.box).sort()).toEqual([
      "inbox",
      "outbox",
    ]);
    expect(
      body.sourceErrors.every((error) => error.service === "caseworking"),
    ).toBe(true);
  });

  it(
    "a Caseworking timeout returns GAS rows with a timeout sourceError",
    { timeout: 20000 },
    async () => {
      await inbox.insertOne(inboxDoc(1));
      await setCwStub({ inbox: { mode: "timeout" } });

      // GAS waits out its own 3 s client timeout, so this request needs a
      // longer one than the shared test client's default.
      const body = await findEvents("", { timeout: 15000 });

      expect(body.events).toHaveLength(1);
      expect(body.sourceErrors).toEqual([
        { service: "caseworking", box: "inbox", message: "timeout" },
      ]);
    },
  );

  it("still pages GAS rows while Caseworking is unavailable", async () => {
    await inbox.insertMany(
      Array.from({ length: 25 }, (_, n) => inboxDoc(n + 1)),
    );
    await setCwStub({ inbox: { mode: "down" }, outbox: { mode: "down" } });

    const first = await findEvents();

    expect(first.events).toHaveLength(20);
    expect(first.pagination.hasNextPage).toBe(true);

    const second = await findEvents(
      `?cursor=${encodeURIComponent(first.pagination.endCursor)}`,
    );

    expect(second.events).toHaveLength(5);
    expect(second.pagination.hasNextPage).toBe(false);
  });

  it("validates the merged payload against the published response schema", async () => {
    await inbox.insertOne(inboxDoc(1, { eventTime: null }));
    await outbox.insertMany([outboxDoc(2), auditOutboxDoc(3)]);
    await setCwStub({
      inbox: { data: [cwInboxRow(4)] },
      outbox: {
        data: [cwOutboxRow(5, { eventId: null, type: null })],
      },
    });

    const body = await findEvents();

    expect(body.events).toHaveLength(5);
    expect(findEventsResponseSchema.validate(body).error).toBeUndefined();
  });
});

describe("swagger", () => {
  it("documents GET /grant-admin/events with its response schema", async () => {
    const { payload } = await wreck.get("/swagger.json");

    expect(Object.keys(payload.paths)).toContain("/grant-admin/events");
    expect(
      JSON.stringify(payload.paths["/grant-admin/events"].get.responses),
    ).toContain("FindEventsResponse");
    expect(Object.keys(payload.definitions)).toEqual(
      expect.arrayContaining([
        "FindEventsResponse",
        "Event",
        "EventPagination",
        "EventSourceError",
      ]),
    );
  });
});

describe("GET /grant-admin/events?q=", () => {
  it("matches an inbox row on its messageId exactly", async () => {
    await inbox.insertMany([inboxDoc(1), inboxDoc(2)]);

    const body = await findEvents("?q=msg-1");

    expect(body.events.map((event) => event.eventId)).toEqual(["msg-1"]);
  });

  it("matches an outbox row on its event.id exactly", async () => {
    await outbox.insertMany([outboxDoc(1), outboxDoc(2)]);

    const body = await findEvents("?q=evt-2");

    expect(body.events.map((event) => event.eventId)).toEqual(["evt-2"]);
  });

  it("matches both boxes on an exact segregationRef", async () => {
    await inbox.insertOne(inboxDoc(1));
    await outbox.insertOne(outboxDoc(1));
    await inbox.insertOne(inboxDoc(2));

    const body = await findEvents("?q=GLD-9B2-BWS-1");

    expect(body.events.map((event) => event.box).sort()).toEqual([
      "inbox",
      "outbox",
    ]);
    expect(
      body.events.every((event) => event.segregationRef === "GLD-9B2-BWS-1"),
    ).toBe(true);
  });

  it("matches a segregationRef prefix case-insensitively", async () => {
    await inbox.insertMany([inboxDoc(1), inboxDoc(2)]);
    await outbox.insertOne(outboxDoc(3));

    const body = await findEvents("?q=gld-9b2");

    expect(body.events).toHaveLength(3);
  });

  it("matches a row on its 24-hex _id", async () => {
    const { insertedId } = await outbox.insertOne(outboxDoc(1));
    await outbox.insertOne(outboxDoc(2));

    const body = await findEvents(`?q=${insertedId.toHexString()}`);

    expect(body.events.map((event) => event.id)).toEqual([
      insertedId.toHexString(),
    ]);
  });

  it("returns 200 with no events for a q that matches nothing", async () => {
    await inbox.insertOne(inboxDoc(1));
    await outbox.insertOne(outboxDoc(2));

    const body = await findEvents("?q=nonexistent-ref");

    expect(body.events).toEqual([]);
    expect(body.sourceErrors).toEqual([]);
    expect(body.pagination.startCursor).toBeNull();
  });

  it("treats regex metacharacters in q as literal text", async () => {
    await inbox.insertMany([inboxDoc(1), inboxDoc(2)]);

    const body = await findEvents("?q=.%2A");

    expect(body.events).toEqual([]);
  });

  it("matches a segregationRef that itself contains regex metacharacters", async () => {
    await inbox.insertOne(inboxDoc(1, { segregationRef: "GLD.9B2+BWS" }));
    await inbox.insertOne(inboxDoc(2));

    const body = await findEvents("?q=GLD.9B2%2B");

    expect(body.events.map((event) => event.segregationRef)).toEqual([
      "GLD.9B2+BWS",
    ]);
  });

  it("treats a whitespace-only q as absent", async () => {
    await inbox.insertOne(inboxDoc(1));
    await outbox.insertOne(outboxDoc(2));

    const body = await findEvents("?q=%20%20");

    expect(body.events).toHaveLength(2);
  });

  it("combines q with status", async () => {
    await inbox.insertOne(inboxDoc(1));
    await inbox.insertOne(inboxDoc(2, { status: "DEAD_LETTER" }));

    const body = await findEvents("?q=gld-9b2&status=DEAD_LETTER");

    expect(body.events.map((event) => event.eventId)).toEqual(["msg-2"]);
  });

  it("responds 400 for a q longer than 200 characters", async () => {
    await expect(findEvents(`?q=${"a".repeat(201)}`)).rejects.toMatchObject({
      output: { statusCode: 400 },
    });
  });
});

// The TYPE (domain/audit) filter is GONE. `kind` is no longer a known query
// parameter, so it 400s the way any unknown one does rather than being quietly
// ignored - an operator on a stale bookmarked URL is told, not silently shown
// everything. Audit rows still appear in the list, inline with every other row.
describe("GET /grant-admin/events and audit rows", () => {
  // Both audit shapes the outbox actually stores: a payload carrying an
  // `audit` object, and a row addressed to the service's own audit topic.
  const auditPayloadOnlyDoc = (n) =>
    outboxDoc(n, {
      target:
        "arn:aws:sns:eu-west-2:000000000000:gas__sns__create_new_case_fifo.fifo",
      event: {
        datetime: at(n),
        audit: {
          entities: [{ entity: "CASE", action: "CREATE_CASE" }],
        },
      },
    });

  const auditTargetOnlyDoc = (n) =>
    outboxDoc(n, {
      target: "arn:aws:sns:eu-west-2:000000000000:gas__sns__audit_topic_arn",
    });

  it.each([
    ["kind=audit", "?kind=audit"],
    ["kind=domain", "?kind=domain"],
    ["an unknown kind", "?kind=other"],
    ["an empty kind", "?kind="],
  ])("responds 400 for %s - it is not a parameter any more", async (_n, q) => {
    await expect(findEvents(q)).rejects.toMatchObject({
      output: { statusCode: 400 },
    });
  });

  it("returns audit rows alongside domain ones, in one unfiltered page", async () => {
    await inbox.insertOne(inboxDoc(1));
    const { insertedIds } = await outbox.insertMany([
      outboxDoc(2),
      auditOutboxDoc(3),
    ]);

    const body = await findEvents();

    expect(body.events).toHaveLength(3);
    expect(body.events.map((event) => `${event.box}/${event.eventId}`)).toEqual(
      [`outbox/${insertedIds[1]}`, "outbox/evt-2", "inbox/msg-1"],
    );
  });

  // An audit record is not a CloudEvent, so it genuinely has no type. Nothing
  // is synthesised for it: `type` is null, exactly as `fullType` already was.
  it("returns a null type for an audit row recognised by its payload shape", async () => {
    await outbox.insertMany([outboxDoc(1), auditPayloadOnlyDoc(2)]);

    const body = await findEvents();

    expect(body.events.map((event) => event.type)).toEqual([
      null,
      "case.create",
    ]);
    expect(body.events[0].fullType).toBeNull();
  });

  // The audit TOPIC no longer says anything about a row's type: what a row
  // stores is all that is read. A row on that topic that does carry a
  // CloudEvent type keeps it, and one that carries none has none.
  it("keeps the stored type on a row addressed at the audit topic", async () => {
    await outbox.insertOne(auditTargetOnlyDoc(1));

    const body = await findEvents();

    expect(body.events[0].type).toEqual("case.create");
    expect(body.events[0].target).toEqual("gas__sns__audit_topic_arn");
  });

  it("keeps the _id fallback for eventId on an audit row", async () => {
    const { insertedId } = await outbox.insertOne(auditOutboxDoc(1));

    const [row] = (await findEvents()).events;

    expect(row.eventId).toEqual(insertedId.toString());
  });

  it("finds an audit row by q, the same way any other row is found", async () => {
    await outbox.insertMany([auditOutboxDoc(1), auditOutboxDoc(2)]);

    const body = await findEvents("?q=GLD-9B2-BWS-2");

    expect(body.events).toHaveLength(1);
    expect(body.events[0].segregationRef).toEqual("GLD-9B2-BWS-2");
  });
});

describe("GET /grant-admin/events lastError", () => {
  const lastError = {
    name: "ClaimExpired",
    message: "claim expired before completion",
    at: "2026-06-16T10:16:05.000Z",
  };

  it("returns null lastError for rows written before the field existed", async () => {
    await inbox.insertOne(inboxDoc(1));
    await outbox.insertOne(outboxDoc(2));

    const body = await findEvents();

    expect(body.events.map((event) => event.lastError)).toEqual([null, null]);
  });

  it("surfaces a stored lastError on a GAS inbox row", async () => {
    await inbox.insertOne(inboxDoc(1, { status: "DEAD_LETTER", lastError }));

    const [row] = (await findEvents()).events;

    expect(row.lastError).toEqual(lastError);
  });

  it("surfaces a stored lastError on a GAS outbox row", async () => {
    await outbox.insertOne(outboxDoc(1, { status: "DEAD_LETTER", lastError }));

    const [row] = (await findEvents()).events;

    expect(row.lastError).toEqual(lastError);
  });

  it("never returns the stack of a stored lastError", async () => {
    await outbox.insertOne(
      outboxDoc(1, {
        status: "DEAD_LETTER",
        lastError: { ...lastError, stack: "SECRET-STACK" },
      }),
    );

    expect(JSON.stringify(await findEvents())).not.toContain("SECRET-STACK");
  });

  it("records the real publish failure when the outbox cannot reach its topic", async () => {
    await outbox.insertOne(
      outboxDoc(1, {
        status: "PUBLISHED",
        completionDate: null,
        target: "arn:aws:sns:eu-west-2:000000000000:gas__sns__no_such_topic",
      }),
    );

    await vi.waitFor(
      async () => {
        const [row] = (await findEvents("?q=evt-1")).events;

        expect(row?.lastError).not.toBeNull();
        expect(row.lastError.name).toEqual(expect.any(String));
        expect(row.lastError.message.length).toBeGreaterThan(0);
        expect(row.lastError.message.length).toBeLessThanOrEqual(1024);
        expect(row.lastError.at).toEqual(
          new Date(row.lastError.at).toISOString(),
        );
      },
      { timeout: 8000, interval: 250 },
    );
  });
});

describe("GET /grant-admin/events forwards q to Caseworking", () => {
  it("forwards q on both actuator calls", async () => {
    await findEvents("?q=GLD-9B2-BWS");

    const calls = await cwStubRequests();

    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.query).toMatchObject({
        q: "GLD-9B2-BWS",
        pageSize: "20",
        direction: "forward",
      });
    }
  });

  it("sends no q when it is not given", async () => {
    await findEvents();

    for (const call of await cwStubRequests()) {
      expect(call.query).not.toHaveProperty("q");
    }
  });

  // The TYPE filter is gone on both sides: nothing about kind is ever sent.
  it("never sends a kind to Caseworking", async () => {
    await findEvents("?q=GLD-9B2-BWS");

    for (const call of await cwStubRequests()) {
      expect(call.query).not.toHaveProperty("kind");
    }
  });

  it("sends the trimmed q, not the raw one", async () => {
    await findEvents("?q=%20%20evt-1%20%20");

    for (const call of await cwStubRequests()) {
      expect(call.query.q).toEqual("evt-1");
    }
  });

  it("surfaces a lastError carried by a Caseworking row", async () => {
    const lastError = {
      name: "TimeoutError",
      message: "publish timed out",
      at: "2026-06-16T10:16:05.000Z",
    };

    await setCwStub({
      inbox: {
        data: [
          {
            _id: "665f1c2e9a1b2c3d4e5f0001",
            eventId: "cw-evt-1",
            type: "cloud.defra.local.fg-cw-backend.case.status.updated",
            source: "GAS",
            segregationRef: "CW-REF-1",
            status: "DEAD_LETTER",
            completionAttempts: 3,
            maxAttempts: 7,
            traceparent: null,
            createdAt: at(1),
            lastFailureAt: at(1),
            lastError,
            completedAt: null,
          },
        ],
      },
    });

    const [row] = (await findEvents()).events;

    expect(row.lastError).toEqual(lastError);
  });

  it("returns a null lastError for a Caseworking row that carries none", async () => {
    await setCwStub({
      inbox: {
        data: [
          {
            _id: "665f1c2e9a1b2c3d4e5f0002",
            eventId: "cw-evt-2",
            type: "cloud.defra.local.fg-cw-backend.case.status.updated",
            source: "GAS",
            segregationRef: "CW-REF-2",
            status: "COMPLETED",
            completionAttempts: 1,
            maxAttempts: 7,
            traceparent: null,
            createdAt: at(2),
            lastFailureAt: null,
            completedAt: at(2),
          },
        ],
      },
    });

    const [row] = (await findEvents()).events;

    expect(row.lastError).toBeNull();
  });
});

describe("GET /grant-admin/events from and to", () => {
  // at(n) is 2026-06-16T10:{n}:00.000Z; the inbox keys off eventTime (a
  // string) and the outbox off publicationDate (a Date), so this exercises
  // both column types end to end.
  const idsOf = (body) => body.events.map((row) => row.eventId).sort();

  beforeEach(async () => {
    await inbox.insertMany([inboxDoc(10), inboxDoc(20), inboxDoc(30)]);
    await outbox.insertMany([outboxDoc(15), outboxDoc(25)]);
  });

  it("returns everything with no bounds", async () => {
    expect(idsOf(await findEvents())).toEqual([
      "evt-15",
      "evt-25",
      "msg-10",
      "msg-20",
      "msg-30",
    ]);
  });

  it("narrows both boxes with from and to", async () => {
    const body = await findEvents(`?from=${at(15)}&to=${at(25)}`);

    expect(idsOf(body)).toEqual(["evt-15", "evt-25", "msg-20"]);
    expect(findEventsResponseSchema.validate(body).error).toBeUndefined();
  });

  it("is inclusive at both ends", async () => {
    expect(idsOf(await findEvents(`?from=${at(20)}&to=${at(20)}`))).toEqual([
      "msg-20",
    ]);
    expect(idsOf(await findEvents(`?from=${at(25)}&to=${at(25)}`))).toEqual([
      "evt-25",
    ]);
  });

  it("accepts from on its own", async () => {
    expect(idsOf(await findEvents(`?from=${at(25)}`))).toEqual([
      "evt-25",
      "msg-30",
    ]);
  });

  it("accepts to on its own", async () => {
    expect(idsOf(await findEvents(`?to=${at(15)}`))).toEqual([
      "evt-15",
      "msg-10",
    ]);
  });

  it("returns an empty page for a range with nothing in it", async () => {
    const body = await findEvents(
      "?from=2020-01-01T00:00:00.000Z&to=2020-01-02T00:00:00.000Z",
    );

    expect(body.events).toEqual([]);
    expect(body.pagination.startCursor).toBeNull();
  });

  it("combines the range with q", async () => {
    expect(
      idsOf(await findEvents(`?from=${at(10)}&to=${at(30)}&q=GLD-9B2-BWS-20`)),
    ).toEqual(["msg-20"]);
  });

  it("forwards both bounds to Caseworking", async () => {
    await findEvents(`?from=${at(15)}&to=${at(25)}`);

    const requests = await cwStubRequests();

    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.query.from).toBe(at(15));
      expect(request.query.to).toBe(at(25));
    }
  });

  it("400s on a bound that is not an ISO date", async () => {
    await expect(findEvents("?from=yesterday")).rejects.toThrow(
      "Response Error: 400 Bad Request",
    );
  });

  it("400s when from is after to", async () => {
    await expect(findEvents(`?from=${at(30)}&to=${at(10)}`)).rejects.toThrow(
      "Response Error: 400 Bad Request",
    );
  });
});

describe("GET /grant-admin/events wider q", () => {
  it("finds a row by its exact traceparent", async () => {
    await inbox.insertOne(inboxDoc(41));

    const body = await findEvents(
      "?q=00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    );

    expect(body.events.map((row) => row.eventId)).toContain("msg-41");
  });

  it("finds an outbox row by the traceparent inside its event", async () => {
    await outbox.insertOne(outboxDoc(42));

    const body = await findEvents(
      "?q=00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    );

    expect(body.events.map((row) => row.eventId)).toContain("evt-42");
  });

  it("finds a row by event.data.clientRef", async () => {
    await inbox.insertOne(inboxDoc(43));

    const body = await findEvents("?q=SECRET-REF");

    expect(body.events.map((row) => row.eventId)).toContain("msg-43");
  });

  it("finds a row by event.data.caseRef", async () => {
    await inbox.insertOne(
      inboxDoc(44, {
        event: { id: "evt-44", time: at(44), data: { caseRef: "CASE-44" } },
      }),
    );

    const body = await findEvents("?q=CASE-44");

    expect(body.events.map((row) => row.eventId)).toContain("msg-44");
  });

  it("still finds a row by its segregationRef prefix", async () => {
    await inbox.insertOne(inboxDoc(45));

    expect(
      (await findEvents("?q=gld-9b2")).events.map((row) => row.eventId),
    ).toContain("msg-45");
  });
});

// The bug behind "when viewing newer events and then older we don't get back
// to the same data": a source that contributes NO rows to a page was handed
// its incoming slice for BOTH outgoing cursors. The incoming slice is that
// source's boundary row on the page we came FROM, and keyset reads are
// strictly exclusive, so the cursor pointing back the other way skipped
// precisely the row the operator was turning round to see.
//
// The seed puts each GAS box on its own side of the fold: twenty outbox rows
// fill page one on their own, and the inbox rows below them are page two. So
// the inbox contributes nothing going forward and the outbox contributes
// nothing coming back, which exercises both halves of the fix at once.
describe("GET /grant-admin/events paging round trip", () => {
  const PAGE = 20;
  const OUTBOX_MINUTES = Array.from({ length: PAGE }, (_, i) => i + 21);
  const INBOX_MINUTES = [1, 2, 3, 4, 5, 6];

  const seed = async () => {
    await outbox.insertMany(OUTBOX_MINUTES.map((n) => outboxDoc(n)));
    await inbox.insertMany(INBOX_MINUTES.map((n) => inboxDoc(n)));
  };

  const idsOf = (body) =>
    body.events.map((event) => `${event.box}/${event.createdAt}`);

  const older = (body) =>
    findEvents(
      `?service=gas&cursor=${encodeURIComponent(body.pagination.endCursor)}&direction=forward`,
    );

  const newer = (body) =>
    findEvents(
      `?service=gas&cursor=${encodeURIComponent(body.pagination.startCursor)}&direction=backward`,
    );

  it("comes back to the same rows after Older then Newer then Older", async () => {
    await seed();

    const page1 = await findEvents("?service=gas");
    const page2 = await older(page1);
    const backAgain = await newer(page2);
    const forwardAgain = await older(backAgain);

    // The fold is where the fix bites: page one is outbox alone, page two is
    // inbox alone, so each box is the silent one on one of the two legs.
    expect(idsOf(page1)).toHaveLength(PAGE);
    expect(page1.events.every((event) => event.box === "outbox")).toBe(true);
    expect(page2.events.every((event) => event.box === "inbox")).toBe(true);

    expect(idsOf(backAgain)).toEqual(idsOf(page1));
    expect(idsOf(forwardAgain)).toEqual(idsOf(page2));
  });

  it("loses no row and repeats none across the two pages", async () => {
    await seed();

    const page1 = await findEvents("?service=gas");
    const page2 = await older(page1);
    const seen = [...idsOf(page1), ...idsOf(page2)];

    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toHaveLength(PAGE + INBOX_MINUTES.length);
  });

  // The silent source going forward is the inbox: it offered candidates and
  // every one of them was outranked, so the cursor pointing back has to be
  // built from the nearest of those rather than from what came in.
  it("keeps the newest inbox row on page two after a round trip", async () => {
    await seed();

    const page1 = await findEvents("?service=gas");
    const page2 = await older(page1);
    const forwardAgain = await older(await newer(page2));

    expect(page2.events[0].createdAt).toEqual(at(6));
    expect(forwardAgain.events[0].createdAt).toEqual(at(6));
  });

  // The silent source coming back is the outbox: it offered nothing older, so
  // its stream ends at the incoming slice and the far end is the honest
  // position - reading from it lands back on that boundary row.
  it("keeps the oldest outbox row on page one after a round trip", async () => {
    await seed();

    const page1 = await findEvents("?service=gas");
    const backAgain = await newer(await older(page1));

    expect(page1.events.at(-1).createdAt).toEqual(at(21));
    expect(backAgain.events.at(-1).createdAt).toEqual(at(21));
  });
});
