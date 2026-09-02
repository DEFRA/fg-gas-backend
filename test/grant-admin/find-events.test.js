import { MongoClient, ObjectId } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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

  it("returns the audit outbox row with an audit type, a null fullType and its _id as eventId", async () => {
    const { insertedIds } = await outbox.insertMany([auditOutboxDoc(1)]);

    const body = await findEvents();
    const [row] = body.events;

    expect(row.type).toEqual("audit · APPLICATION.SUBMIT_APPLICATION");
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
      auditEntities: null,
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

  it("derives an audit type from the auditEntities a Caseworking row carries", async () => {
    await setCwStub({
      outbox: {
        data: [
          cwOutboxRow(1, {
            eventId: null,
            type: null,
            auditEntities: [{ entity: "CASE", action: "CREATE_CASE" }],
          }),
        ],
      },
    });

    const [row] = (await findEvents()).events;

    expect(row.type).toEqual("audit · CASE.CREATE_CASE");
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
        data: [
          cwOutboxRow(5, {
            eventId: null,
            type: null,
            auditEntities: [],
          }),
        ],
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
