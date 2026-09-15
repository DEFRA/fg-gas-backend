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

// The container's pollers rewrite PUBLISHED, FAILED and RESUBMITTED rows mid-test.
const STABLE_STATUSES = ["COMPLETED", "DEAD_LETTER", "PROCESSING"];

const at = (minute) =>
  new Date(Date.UTC(2026, 5, 16, 10, minute)).toISOString();

const inboxDoc = (n, overrides = {}) => ({
  messageId: `msg-${n}`,
  type: "cloud.defra.local.fg-cw-backend.case.status.updated",
  source: "CW",
  status: "COMPLETED",
  completionAttempts: 1,
  publicationDate: at(n),
  // Runs the other way from publicationDate, so a list that read it comes back reversed.
  eventTime: at(100 - n),
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
  const { payload } = await wreck.get(
    `/grant-admin/events/page${query}`,
    options,
  );

  return payload;
};

describe("GET /grant-admin/events/page list", () => {
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
    expect(body.pagination.endCursor).toEqual(expect.any(String));
  });

  it("a row inserted between two requests is neither duplicated nor skipped", async () => {
    await inbox.insertMany(
      Array.from({ length: 25 }, (_, n) => inboxDoc(n + 1)),
    );

    const first = await findEvents();

    await inbox.insertOne(
      inboxDoc(99, { publicationDate: "2027-01-01T00:00:00.000Z" }),
    );

    const seen = [...first.events.map((event) => event.id)];
    let { endCursor, hasNextPage } = first.pagination;

    while (hasNextPage) {
      const page = await findEvents(`?cursor=${encodeURIComponent(endCursor)}`);
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

  it("labels the audit outbox row and falls back to its _id for eventId", async () => {
    const { insertedIds } = await outbox.insertMany([auditOutboxDoc(1)]);

    const body = await findEvents("?audit=include");
    const [row] = body.events;

    expect(row.type).toEqual("audit");
    expect(row.eventId).toEqual(insertedIds[0].toString());
  });

  it("keeps a legacy io.onsite type whole", async () => {
    await outbox.insertMany([
      outboxDoc(1, {
        target: "internal:message-bus",
        event: { id: "evt-1", type: "io.onsite.agreement.status.updated" },
      }),
    ]);

    const [row] = (await findEvents()).events;

    expect(row.type).toEqual("io.onsite.agreement.status.updated");
  });

  it("dates an inbox row by its publicationDate, not the sender's eventTime", async () => {
    await inbox.insertOne(
      inboxDoc(1, {
        publicationDate: "2026-06-16T10:01:00.123Z",
        eventTime: "2026-06-16T09:00:00.000Z",
      }),
    );

    const [row] = (await findEvents()).events;

    expect(row.createdAt).toEqual("2026-06-16T10:01:00.123Z");
  });

  it("falls back to the _id timestamp for an inbox row with no publicationDate", async () => {
    const id = new ObjectId();
    await inbox.insertOne(inboxDoc(1, { _id: id, publicationDate: null }));

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

  it("carries no trace on a list row, from either box", async () => {
    await inbox.insertOne(inboxDoc(1));
    await outbox.insertOne(outboxDoc(2));

    const body = await findEvents();

    expect(JSON.stringify(body)).not.toContain(
      "4bf92f3577b34da6a3ce929d0e0e4736",
    );
  });

  it("never returns an audit row's correlationid", async () => {
    await outbox.insertOne(auditOutboxDoc(1));

    const body = await findEvents("?audit=include");

    expect(JSON.stringify(body)).not.toContain("corr-1");
  });

  it("returns no event, claimedBy, entityid, kind or full ARN anywhere in the payload", async () => {
    await inbox.insertOne(inboxDoc(1));
    await outbox.insertMany([outboxDoc(2), auditOutboxDoc(3)]);

    const serialised = JSON.stringify(await findEvents("?audit=include"));

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

  it("takes nothing at all from the event a row carries", async () => {
    await outbox.insertOne(outboxDoc(1));

    const serialised = JSON.stringify(await findEvents());

    expect(serialised).not.toContain("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(serialised).not.toContain('"event"');
    expect(serialised).not.toContain("SECRET-REF");
  });

  it("carries exactly the keys the table draws, from either box", async () => {
    await inbox.insertOne(inboxDoc(1));
    await outbox.insertOne(outboxDoc(2));

    const body = await findEvents();

    expect(body.events).toHaveLength(2);
    for (const row of body.events) {
      expect(Object.keys(row).sort()).toEqual(
        [
          "service",
          "box",
          "id",
          "eventId",
          "type",
          "status",
          "statusLabel",
          "statusRole",
          "statusRetrying",
          "createdAt",
          "latency",
          "latencyTitle",
        ].sort(),
      );
    }
  });

  it("an empty database returns an empty page with a null cursor", async () => {
    const body = await findEvents();

    expect(body.events).toEqual([]);
    expect(body.pagination).toEqual({
      endCursor: null,
      hasNextPage: false,
    });
  });

  it("responds 401 without a service bearer token", async () => {
    await expect(
      wreck.get("/grant-admin/events/page", {
        headers: {
          authorization: "Bearer 11111111-1111-1111-1111-111111111111",
        },
      }),
    ).rejects.toMatchObject({ output: { statusCode: 401 } });
  });
});

describe("GET /grant-admin/events/page list with Caseworking", () => {
  const cwRow = (n, overrides = {}) => ({
    _id: `665f1c2e9a1b2c3d4e5f${String(n).padStart(4, "0")}`,
    eventId: `cw-evt-${n}`,
    type: "cloud.defra.local.fg-cw-backend.case.status.updated",
    status: "COMPLETED",
    publicationDate: at(n),
    completedAt: at(n),
    ...overrides,
  });

  const cwInboxRow = cwRow;
  const cwOutboxRow = cwRow;

  const paged = (rows) => ({
    data: rows,
    pagination: { endCursor: null, hasNextPage: true },
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
  });

  it("carries exactly the keys the table draws on a Caseworking row", async () => {
    await setCwStub({ inbox: { data: [cwInboxRow(1)] } });

    const [row] = (await findEvents()).events;

    expect(Object.keys(row).sort()).toEqual(
      [
        "service",
        "box",
        "id",
        "eventId",
        "type",
        "status",
        "statusLabel",
        "statusRole",
        "statusRetrying",
        "createdAt",
        "latency",
        "latencyTitle",
      ].sort(),
    );
  });

  it("labels a Caseworking row that carries no type unknown", async () => {
    await setCwStub({
      outbox: { data: [cwOutboxRow(1, { eventId: null, type: null })] },
    });

    const [row] = (await findEvents()).events;

    expect(row.type).toEqual("unknown");
    expect(row.eventId).toEqual("665f1c2e9a1b2c3d4e5f0001");
  });

  it("calls the actuator once with the bearer token, pageSize 20 and the filters", async () => {
    await findEvents("?status=DEAD_LETTER");

    const calls = await cwStubRequests();

    expect(calls.map((call) => call.path)).toEqual(["/actuators/events"]);
    expect(calls[0].authorization).toEqual("Bearer cw-stub-token");
    expect(calls[0].query).toMatchObject({
      pageSize: "20",
      status: "DEAD_LETTER",
      audit: "exclude",
    });
    expect(calls[0].query).not.toHaveProperty("inboxCursor");
    expect(calls[0].query).not.toHaveProperty("outboxCursor");
  });

  it("forwards each Caseworking box's slice of the composite cursor on the next page", async () => {
    await setCwStub({
      inbox: paged([cwInboxRow(1)]),
      outbox: paged([cwOutboxRow(2)]),
    });

    const first = await findEvents();
    await resetCwStub();
    await findEvents(
      `?cursor=${encodeURIComponent(first.pagination.endCursor)}`,
    );

    const [call] = await cwStubRequests();
    const sliceOf = (value) =>
      JSON.parse(Buffer.from(value, "base64url").toString());

    expect(sliceOf(call.query.inboxCursor)).toEqual({
      publicationDate: at(1),
      _id: "665f1c2e9a1b2c3d4e5f0001",
    });
    expect(sliceOf(call.query.outboxCursor)).toEqual({
      publicationDate: at(2),
      _id: "665f1c2e9a1b2c3d4e5f0002",
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
    expect((await cwStubRequests()).map((call) => call.path)).toEqual([
      "/actuators/events",
    ]);
  });

  it("a Caseworking 401 returns GAS rows with a sourceError for both boxes and no response body anywhere", async () => {
    await inbox.insertOne(inboxDoc(1));
    await setCwStub({ inbox: { mode: "unauthorized" } });

    const body = await findEvents();

    expect(body.events).toHaveLength(1);
    expect(body.sourceErrors).toEqual([
      { hop: "CW-BE Inbox" },
      { hop: "CW-BE Outbox" },
    ]);
    expect(JSON.stringify(body)).not.toContain("SECRET-CW-401-BODY");
  });

  it("a Caseworking 500 returns GAS rows with a sourceError for both boxes", async () => {
    await inbox.insertOne(inboxDoc(1));
    await setCwStub({ outbox: { mode: "error" } });

    const body = await findEvents();

    expect(body.sourceErrors).toEqual([
      { hop: "CW-BE Inbox" },
      { hop: "CW-BE Outbox" },
    ]);
    expect(JSON.stringify(body)).not.toContain("SECRET-CW-500-BODY");
  });

  it("names only the box Caseworking could not read, and keeps the other's rows", async () => {
    await inbox.insertOne(inboxDoc(1));
    await setCwStub({
      inbox: { data: [cwInboxRow(2)] },
      outbox: { mode: "unreadable" },
    });

    const body = await findEvents();

    expect(body.events.map((event) => `${event.service}/${event.box}`)).toEqual(
      ["caseworking/inbox", "gas/inbox"],
    );
    expect(body.sourceErrors).toEqual([{ hop: "CW-BE Outbox" }]);
  });

  it("a Caseworking connection failure returns GAS rows with a sourceError for both boxes", async () => {
    await inbox.insertOne(inboxDoc(1));
    await setCwStub({ inbox: { mode: "down" } });

    const body = await findEvents();

    expect(body.events).toHaveLength(1);
    expect(body.sourceErrors.map((error) => error.hop)).toEqual([
      "CW-BE Inbox",
      "CW-BE Outbox",
    ]);
  });

  it(
    "a Caseworking timeout returns GAS rows with a timeout sourceError for both boxes",
    { timeout: 20000 },
    async () => {
      await inbox.insertOne(inboxDoc(1));
      await setCwStub({ inbox: { mode: "timeout" } });

      // GAS waits out its own 4 s client timeout first.
      const body = await findEvents("", { timeout: 15000 });

      expect(body.events).toHaveLength(1);
      expect(body.sourceErrors).toEqual([
        { hop: "CW-BE Inbox" },
        { hop: "CW-BE Outbox" },
      ]);
    },
  );

  it("still pages GAS rows while CW-BE is unavailable", async () => {
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
    await inbox.insertOne(inboxDoc(1, { publicationDate: null }));
    await outbox.insertMany([outboxDoc(2), auditOutboxDoc(3)]);
    await setCwStub({
      inbox: { data: [cwInboxRow(4)] },
      outbox: {
        data: [cwOutboxRow(5, { eventId: null, type: null })],
      },
    });

    const body = await findEvents("?audit=include");

    expect(body.events).toHaveLength(5);
    expect(eventsPageResponseSchema.validate(body).error).toBeUndefined();
  });
});

describe("GET /grant-admin/events/page list with q", () => {
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
    expect(body.events.map((event) => event.eventId).sort()).toEqual([
      "evt-1",
      "msg-1",
    ]);
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
    expect(body.pagination.endCursor).toBeNull();
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

    expect(body.events.map((event) => event.eventId)).toEqual(["msg-1"]);
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

describe("GET /grant-admin/events/page list and audit rows", () => {
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

  it("returns audit rows alongside domain ones when they are asked for", async () => {
    await inbox.insertOne(inboxDoc(1));
    const { insertedIds } = await outbox.insertMany([
      outboxDoc(2),
      auditOutboxDoc(3),
    ]);

    const body = await findEvents("?audit=include");

    expect(body.events).toHaveLength(3);
    expect(body.events.map((event) => `${event.box}/${event.eventId}`)).toEqual(
      [`outbox/${insertedIds[1]}`, "outbox/evt-2", "inbox/msg-1"],
    );
  });

  it("labels a type-less row that merely carries an audit payload unknown", async () => {
    await outbox.insertMany([outboxDoc(1), auditPayloadOnlyDoc(2)]);

    const body = await findEvents("?audit=include");

    expect(body.events.map((event) => event.type)).toEqual([
      "unknown",
      "case.create",
    ]);
  });

  it("keeps that unknown row on a default page", async () => {
    await outbox.insertMany([outboxDoc(1), auditPayloadOnlyDoc(2)]);

    const body = await findEvents();

    expect(body.events.map((event) => event.type)).toEqual([
      "unknown",
      "case.create",
    ]);
  });

  it("keeps the stored type on a row addressed at the audit topic", async () => {
    await outbox.insertOne(auditTargetOnlyDoc(1));

    const body = await findEvents("?audit=include");

    expect(body.events[0].type).toEqual("case.create");
  });

  it("keeps the _id fallback for eventId on an audit row", async () => {
    const { insertedId } = await outbox.insertOne(auditOutboxDoc(1));

    const [row] = (await findEvents("?audit=include")).events;

    expect(row.eventId).toEqual(insertedId.toString());
  });

  it("finds an audit row by q, the same way any other row is found", async () => {
    const { insertedIds } = await outbox.insertMany([
      auditOutboxDoc(1),
      auditOutboxDoc(2),
    ]);

    const body = await findEvents("?q=GLD-9B2-BWS-2&audit=include");

    expect(body.events).toHaveLength(1);
    expect(body.events[0].eventId).toEqual(insertedIds[1].toString());
  });
});

describe("GET /grant-admin/events/page list lastError", () => {
  const lastError = {
    name: "ClaimExpired",
    message: "claim expired before completion",
    at: "2026-06-16T10:16:05.000Z",
  };

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

        expect(row).toBeDefined();

        const { payload: detail } = await wreck.get(
          `/grant-admin/events/gas/outbox/${row.id}`,
        );

        expect(detail.lastError).not.toBeNull();
        expect(detail.lastError.name).toEqual(expect.any(String));
        expect(detail.lastError.message.length).toBeGreaterThan(0);
        expect(detail.lastError.message.length).toBeLessThanOrEqual(1024);
        expect(detail.lastError.at).toEqual(
          new Date(detail.lastError.at).toISOString(),
        );
      },
      { timeout: 8000, interval: 250 },
    );
  });
});

describe("GET /grant-admin/events/page list forwards q to Caseworking", () => {
  it("forwards q on the one actuator call", async () => {
    await findEvents("?q=GLD-9B2-BWS");

    const calls = await cwStubRequests();

    expect(calls).toHaveLength(1);
    expect(calls[0].query).toMatchObject({
      q: "GLD-9B2-BWS",
      pageSize: "20",
    });
  });

  it("sends no q when it is not given", async () => {
    await findEvents();

    const [call] = await cwStubRequests();

    expect(call.query).not.toHaveProperty("q");
  });

  it("sends the trimmed q, not the raw one", async () => {
    await findEvents("?q=%20%20evt-1%20%20");

    const [call] = await cwStubRequests();

    expect(call.query.q).toEqual("evt-1");
  });
});

describe("GET /grant-admin/events/page list from and to", () => {
  // Inbox publicationDate is a string and outbox a Date, so both column types are exercised.
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
    expect(eventsPageResponseSchema.validate(body).error).toBeUndefined();
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
    expect(body.pagination.endCursor).toBeNull();
  });

  it("combines the range with q", async () => {
    expect(
      idsOf(await findEvents(`?from=${at(10)}&to=${at(30)}&q=GLD-9B2-BWS-20`)),
    ).toEqual(["msg-20"]);
  });

  it("forwards both bounds to Caseworking", async () => {
    await findEvents(`?from=${at(15)}&to=${at(25)}`);

    const requests = await cwStubRequests();

    expect(requests).toHaveLength(1);
    expect(requests[0].query.from).toBe(at(15));
    expect(requests[0].query.to).toBe(at(25));
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

describe("GET /grant-admin/events/page list wider q", () => {
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

// Outbox fills page one and inbox page two, so turning the page crosses sources.
describe("GET /grant-admin/events/page list paging across both boxes", () => {
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
      `?service=gas&cursor=${encodeURIComponent(body.pagination.endCursor)}`,
    );

  it("loses no row and repeats none across the two pages", async () => {
    await seed();

    const page1 = await findEvents("?service=gas");
    const page2 = await older(page1);

    expect(idsOf(page1)).toHaveLength(PAGE);
    expect(page1.events.every((event) => event.box === "outbox")).toBe(true);
    expect(page2.events.every((event) => event.box === "inbox")).toBe(true);

    const seen = [...idsOf(page1), ...idsOf(page2)];

    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toHaveLength(PAGE + INBOX_MINUTES.length);
  });

  // The inbox offered nothing on page one, so its slice must keep its incoming position.
  it("keeps the newest inbox row at the top of page two", async () => {
    await seed();

    const page2 = await older(await findEvents("?service=gas"));

    expect(page2.events[0].createdAt).toEqual(at(6));
  });
});
