import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { up } from "../../migrations/20261016100000-restamp-events.js";

vi.mock("../../src/common/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const AUDIT_TOPIC =
  "arn:aws:sns:eu-west-2:111111111111:gas__sns__audit_topic_arn";
const CASE_TOPIC = "arn:aws:sns:eu-west-2:111111111111:create_new_case";
const TRACEPARENT = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
const TRACE = "trace:4bf92f3577b34da6a3ce929d0e0e4736";

const lastError = {
  name: "TypeError",
  message: 'Case with id "6acf62688ec1821be59b4d18" not found',
  at: "2026-09-01T10:00:00.000Z",
};

const caseCreate = (overrides) => ({
  target: CASE_TOPIC,
  status: "COMPLETED",
  publicationDate: new Date("2026-09-01T10:00:00.000Z"),
  segregationRef: "abc-123-example-grant",
  event: {
    id: "0b7c1d1e-0000-4000-8000-000000000001",
    type: "cloud.defra.prod.fg-gas-backend.case.create",
    traceparent: TRACEPARENT,
    data: { caseRef: "abc-123", workflowCode: "example-grant" },
  },
  ...overrides,
});

const auditRow = (overrides) => ({
  target: AUDIT_TOPIC,
  status: "COMPLETED",
  publicationDate: new Date("2026-09-01T10:00:01.000Z"),
  segregationRef: "abc-123",
  event: { correlationid: "trace-1" },
  ...overrides,
});

const inboxRow = (overrides) => ({
  source: "CW",
  status: "COMPLETED",
  publicationDate: "2026-09-01T10:00:02.000Z",
  messageId: "0b7c1d1e-0000-4000-8000-000000000002",
  traceparent: TRACEPARENT,
  type: "cloud.defra.prod.fg-cw-backend.case.status.updated",
  segregationRef: "abc-123-example-grant",
  event: {
    id: "0b7c1d1e-0000-4000-8000-000000000002",
    type: "cloud.defra.prod.fg-cw-backend.case.status.updated",
    data: { caseRef: "abc-123", workflowCode: "example-grant" },
  },
  ...overrides,
});

// As the FGP-1500 writers stamped them before case links.
const CREATE_REFS = [
  "ref:abc-123",
  "id:0b7c1d1e-0000-4000-8000-000000000001",
  TRACE,
];

const STATUS_REFS = [
  "ref:abc-123",
  "id:0b7c1d1e-0000-4000-8000-000000000002",
  TRACE,
];

const stampedCaseCreate = () =>
  caseCreate({ eventType: "CreateCase", refs: CREATE_REFS });

const stampedInboxRow = () =>
  inboxRow({ eventType: "CaseStatusUpdated", refs: STATUS_REFS });

let replSet;
let client;
let db;
let outbox;
let inbox;

const everyRow = (collection) => collection.find().sort({ _id: 1 }).toArray();

// Writes to the named collection are dropped, as if a row came in behind the stamp.
const droppingWritesTo = (name) => ({
  collection: (wanted) => {
    const collection = db.collection(wanted);

    return wanted === name
      ? new Proxy(collection, {
          get: (target, key) =>
            key === "bulkWrite"
              ? async () => ({})
              : Reflect.get(target, key, target),
        })
      : collection;
  },
});

// A live writer gets to the named collection between the stamp's read and its write.
const withWriterBetween = (name, write) => ({
  collection: (wanted) => {
    const collection = db.collection(wanted);

    return wanted === name
      ? new Proxy(collection, {
          get: (target, key) =>
            key === "bulkWrite"
              ? async (...args) => {
                  await write(target);

                  return target.bulkWrite(...args);
                }
              : Reflect.get(target, key, target),
        })
      : collection;
  },
});

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  client = await MongoClient.connect(replSet.getUri());
  db = client.db("restamp-events-migration");
  outbox = db.collection("outbox");
  inbox = db.collection("inbox");
}, 120_000);

afterAll(async () => {
  await client?.close();
  await replSet?.stop();
});

beforeEach(async () => {
  await db.dropDatabase();
});

describe("20261016100000-restamp-events", () => {
  it("stamps rows written without stamps, whatever their _id", async () => {
    await outbox.insertMany([
      caseCreate({ status: "DEAD_LETTER", lastError }),
      auditRow(),
    ]);
    await inbox.insertOne(inboxRow());

    await up(db);

    const [create, audit] = await everyRow(outbox);

    expect(create).toMatchObject({
      eventType: "CreateCase",
      refs: [
        "ref:abc-123",
        "case:example-grant:abc-123",
        "id:0b7c1d1e-0000-4000-8000-000000000001",
        TRACE,
      ],
      errorKey: "TypeError: Case with id <v> not found",
    });
    expect(audit).toMatchObject({
      eventType: "Audit",
      refs: ["trace:trace-1"],
    });
    expect(await inbox.findOne()).toMatchObject({
      eventType: "CaseStatusUpdated",
      refs: [
        "ref:abc-123",
        "case:example-grant:abc-123",
        "id:0b7c1d1e-0000-4000-8000-000000000002",
        TRACE,
      ],
    });
  });

  it("adds the case links to rows stamped before them, and changes nothing else", async () => {
    await outbox.insertOne(stampedCaseCreate());
    await inbox.insertOne(stampedInboxRow());

    await up(db);

    expect(await outbox.findOne()).toMatchObject({
      eventType: "CreateCase",
      refs: [...CREATE_REFS, "case:example-grant:abc-123"],
    });
    expect(await inbox.findOne()).toMatchObject({
      eventType: "CaseStatusUpdated",
      refs: [...STATUS_REFS, "case:example-grant:abc-123"],
    });
  });

  it("gives a row whose refs are null its refs, and a recorded error without a key its key", async () => {
    await outbox.insertMany([
      caseCreate({ eventType: "CreateCase", refs: null }),
      auditRow({
        eventType: "Audit",
        refs: ["trace:trace-1"],
        status: "DEAD_LETTER",
        lastError,
      }),
    ]);

    await up(db);

    const [create, audit] = await everyRow(outbox);

    expect(create.refs).toContain("case:example-grant:abc-123");
    expect(audit).toMatchObject({
      refs: ["trace:trace-1"],
      errorKey: "TypeError: Case with id <v> not found",
    });
  });

  it("leaves a stamp already there alone", async () => {
    const stamped = caseCreate({ eventType: "Unrecognised", refs: ["id:1"] });
    const linked = caseCreate({
      eventType: "CreateCase",
      refs: ["case:example-grant:abc-123"],
      lastError,
      errorKey: "kept",
    });
    await outbox.insertMany([stamped, linked]);

    await up(db);

    const [first, second] = await everyRow(outbox);

    expect(first).toEqual(stamped);
    expect(second).toEqual(linked);
  });

  it("never overwrites what a live writer stamps between its read and its write", async () => {
    const later = { name: "Error", message: "Timed out", at: "later" };
    await outbox.insertOne(caseCreate({ status: "DEAD_LETTER", lastError }));

    await up(
      withWriterBetween("outbox", (collection) =>
        collection.updateOne(
          {},
          {
            $set: {
              eventType: "Unrecognised",
              lastError: later,
              errorKey: "Error: Timed out",
            },
          },
        ),
      ),
    );

    expect(await outbox.findOne()).toMatchObject({
      eventType: "Unrecognised",
      lastError: later,
      errorKey: "Error: Timed out",
      refs: expect.arrayContaining(["case:example-grant:abc-123"]),
    });
  });

  it("changes nothing when run again", async () => {
    await outbox.insertMany([
      caseCreate({ status: "DEAD_LETTER", lastError }),
      stampedCaseCreate(),
      auditRow(),
      caseCreate({ event: { id: "1", type: "io.example.retired" } }),
    ]);
    await inbox.insertMany([
      inboxRow(),
      stampedInboxRow(),
      inboxRow({ event: { id: "2", type: inboxRow().type, data: {} } }),
    ]);

    await up(db);
    const outboxOnce = await everyRow(outbox);
    const inboxOnce = await everyRow(inbox);
    await up(db);

    expect(await everyRow(outbox)).toEqual(outboxOnce);
    expect(await everyRow(inbox)).toEqual(inboxOnce);
  });

  it("stamps more rows than one batch holds", async () => {
    await outbox.insertMany(
      Array.from({ length: 2500 }, (_, n) =>
        n % 2 ? caseCreate() : stampedCaseCreate(),
      ),
    );

    await up(db);

    expect(
      await outbox.countDocuments({ refs: "case:example-grant:abc-123" }),
    ).toBe(2500);
  });

  it("fails, naming the box, when a row is left unstamped", async () => {
    await outbox.insertOne(caseCreate());
    await inbox.insertOne(inboxRow());

    await expect(up(droppingWritesTo("inbox"))).rejects.toThrow(
      "1 inbox rows were left unstamped",
    );
    expect(await outbox.findOne()).toHaveProperty("eventType", "CreateCase");
  });
});
