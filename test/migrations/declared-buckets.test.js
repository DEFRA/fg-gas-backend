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
import { up as normaliseStatuslessRows } from "../../migrations/20261014100000-normalise-statusless-outbox-rows.js";
import { up as stampEventFacts } from "../../migrations/20261014110000-stamp-event-facts.js";
import { up as stampApplicationFacts } from "../../migrations/20261014120000-stamp-application-facts.js";
import { up as buildBucketIndexes } from "../../migrations/20261014140000-build-bucket-indexes.js";

vi.mock("../../src/common/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const AUDIT_TOPIC =
  "arn:aws:sns:eu-west-2:111111111111:gas__sns__audit_topic_arn";
const CASE_TOPIC = "arn:aws:sns:eu-west-2:111111111111:create_new_case";
const TRACEPARENT = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

const caseCreate = (overrides) => ({
  target: CASE_TOPIC,
  status: "COMPLETED",
  publicationDate: new Date("2026-09-01T10:00:00.000Z"),
  segregationRef: "abc-123-example-grant",
  event: {
    id: "0b7c1d1e-0000-4000-8000-000000000001",
    type: "cloud.defra.prod.fg-gas-backend.case.create",
    traceparent: TRACEPARENT,
    data: { caseRef: "ABC-123", workflowCode: "example-grant" },
  },
  ...overrides,
});

const auditRow = (overrides) => ({
  target: AUDIT_TOPIC,
  status: "COMPLETED",
  publicationDate: new Date("2026-09-01T10:00:01.000Z"),
  segregationRef: "abc-123",
  event: {
    user: "5f0c2a9e-0000-4000-8000-000000000003",
    correlationid: "trace-1",
    audit: {
      entities: [
        {
          entity: "APPLICATION",
          action: "SUBMIT_APPLICATION",
          entityid: "ABC-123",
        },
      ],
    },
  },
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
    data: { caseRef: "ABC-123", workflowCode: "example-grant" },
  },
  ...overrides,
});

const application = (clientRef, overrides) => ({
  clientRef,
  code: "example-grant",
  createdAt: "2026-09-01T10:00:00.000Z",
  currentStatus: "RECEIVED",
  identifiers: { sbi: "100000001", frn: "1000000001", crn: "1100000001" },
  agreements: {},
  ...overrides,
});

let replSet;
let client;
let db;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  client = await MongoClient.connect(replSet.getUri());
  db = client.db("declared-buckets-migrations");
}, 120_000);

afterAll(async () => {
  await client?.close();
  await replSet?.stop();
});

beforeEach(async () => {
  await db.dropDatabase();
});

describe("normalise statusless outbox rows", () => {
  it("dead-letters a row stored without a status and leaves the rest", async () => {
    const outbox = db.collection("outbox");
    await outbox.insertMany([
      caseCreate({ status: null }),
      caseCreate({ status: undefined }),
      caseCreate({ status: "COMPLETED" }),
    ]);

    await normaliseStatuslessRows(db);

    expect(await outbox.countDocuments({ status: null })).toBe(0);
    expect(
      await outbox.countDocuments({
        status: "DEAD_LETTER",
        "lastError.name": "MissingStatus",
        "lastError.message": "stored without a status",
      }),
    ).toBe(2);
    expect(await outbox.countDocuments({ status: "COMPLETED" })).toBe(1);
  });
});

describe("stamp event facts", () => {
  it("stamps a message written in another environment by its declared name", async () => {
    await db.collection("outbox").insertOne(caseCreate());

    await stampEventFacts(db);

    expect(await db.collection("outbox").findOne()).toMatchObject({
      eventType: "CreateCase",
      refs: [
        "ref:abc-123",
        "case:example-grant:~41.~42.~43.-123",
        "application:example-grant:~41.~42.~43.-123",
        "id:0b7c1d1e-0000-4000-8000-000000000001",
        "trace:4bf92f3577b34da6a3ce929d0e0e4736",
      ],
      status: "COMPLETED",
    });
  });

  it("stamps a row sent to the audit topic as audit", async () => {
    await db.collection("outbox").insertOne(auditRow());

    await stampEventFacts(db);

    expect(await db.collection("outbox").findOne()).toMatchObject({
      eventType: "Audit",
      refs: ["trace:trace-1"],
    });
  });

  it("stamps an inbox row from its own message id and trace", async () => {
    await db.collection("inbox").insertOne(inboxRow());

    await stampEventFacts(db);

    const row = await db.collection("inbox").findOne();

    expect(row).toMatchObject({
      eventType: "CaseStatusUpdated",
      refs: [
        "ref:abc-123",
        "case:example-grant:~41.~42.~43.-123",
        "application:example-grant:~41.~42.~43.-123",
        "id:0b7c1d1e-0000-4000-8000-000000000002",
        "trace:4bf92f3577b34da6a3ce929d0e0e4736",
      ],
    });
    expect(row).not.toHaveProperty("kind");
  });

  it("stamps a type nobody declares unrecognised and never skips the row", async () => {
    await db
      .collection("outbox")
      .insertOne(
        caseCreate({ event: { id: "1", type: "io.example.retired" } }),
      );
    await db.collection("inbox").insertOne(
      inboxRow({
        event: {
          id: "0b7c1d1e-0000-4000-8000-000000000002",
          type: "io.example.retired",
        },
        traceparent: null,
      }),
    );

    await stampEventFacts(db);

    expect(await db.collection("outbox").findOne()).toMatchObject({
      eventType: "Unrecognised",
      refs: ["id:1"],
    });
    expect(await db.collection("inbox").findOne()).toMatchObject({
      eventType: "Unrecognised",
      refs: ["id:0b7c1d1e-0000-4000-8000-000000000002"],
    });
  });

  it("reads an edited row's envelope as it was written", async () => {
    await db.collection("outbox").insertOne(
      caseCreate({
        originalPayload: caseCreate().event,
        event: { id: "edited", type: "edited", data: {} },
      }),
    );

    await stampEventFacts(db);

    expect(await db.collection("outbox").findOne()).toMatchObject({
      eventType: "CreateCase",
      refs: expect.arrayContaining(["ref:abc-123"]),
    });
  });

  it("stamps a recorded error with its key, and a row already stamped but for the key as well", async () => {
    const lastError = {
      name: "TypeError",
      message: 'Case with id "6acf62688ec1821be59b4d18" not found',
      at: "2026-09-01T10:00:00.000Z",
    };
    await db.collection("outbox").insertMany([
      caseCreate({ status: "DEAD_LETTER", lastError }),
      caseCreate({
        status: "DEAD_LETTER",
        lastError,
        eventType: "CreateCase",
        refs: ["ref:abc-123"],
      }),
      caseCreate(),
    ]);

    await stampEventFacts(db);

    expect(
      (await db.collection("outbox").find().sort({ _id: 1 }).toArray()).map(
        ({ errorKey }) => errorKey,
      ),
    ).toEqual([
      "TypeError: Case with id <v> not found",
      "TypeError: Case with id <v> not found",
      undefined,
    ]);
  });

  it("gives a row with no identifier an empty refs list, not a missing one", async () => {
    await db
      .collection("outbox")
      .insertOne(caseCreate({ event: { type: "io.example.retired" } }));

    await stampEventFacts(db);

    expect((await db.collection("outbox").findOne()).refs).toEqual([]);
  });

  it("leaves a row its writer already stamped alone", async () => {
    const stamped = {
      eventType: "ApplicationCreated",
      refs: ["ref:kept"],
    };
    await db.collection("outbox").insertOne(caseCreate(stamped));

    await stampEventFacts(db);

    expect(await db.collection("outbox").findOne()).toMatchObject(stamped);
  });

  it("stamps more rows than one batch holds", async () => {
    await db
      .collection("outbox")
      .insertMany(
        Array.from({ length: 2500 }, (_, n) =>
          n % 2 ? caseCreate() : auditRow(),
        ),
      );

    await stampEventFacts(db);

    const outbox = db.collection("outbox");
    expect(
      await outbox.countDocuments({
        $or: [{ eventType: null }, { refs: null }],
      }),
    ).toBe(0);
    expect(await outbox.countDocuments({ eventType: "CreateCase" })).toBe(1250);
    expect(await outbox.countDocuments({ eventType: "Audit" })).toBe(1250);
    expect(await outbox.countDocuments({ kind: { $exists: true } })).toBe(0);
  });

  it("is safe to run again", async () => {
    await db.collection("outbox").insertMany([caseCreate(), auditRow()]);
    await db.collection("inbox").insertOne(inboxRow());

    await stampEventFacts(db);
    const before = await db.collection("outbox").find().toArray();
    await stampEventFacts(db);

    expect(await db.collection("outbox").find().toArray()).toEqual(before);
  });

  it.each([
    ["outbox", () => caseCreate({ status: "ARCHIVED" })],
    ["inbox", () => inboxRow({ status: "ARCHIVED" })],
  ])("throws over an %s status outside the listed values", async (box, doc) => {
    await db.collection(box).insertOne(doc());

    await expect(stampEventFacts(db)).rejects.toThrow(
      `1 ${box} rows hold a status outside the listed values`,
    );
  });
});

describe("stamp application facts", () => {
  const applications = () => db.collection("applications");
  const byRef = async (clientRef) => applications().findOne({ clientRef });

  it("gives every application its refs, and no replaced flag", async () => {
    await applications().insertOne(
      application("ABC-123", { agreements: { FPTT000000001: {} } }),
    );

    await stampApplicationFacts(db);

    expect(await byRef("ABC-123")).not.toHaveProperty("replaced");
    expect(await byRef("ABC-123")).toMatchObject({
      refs: [
        "ref:abc-123",
        "sbi:100000001",
        "frn:1000000001",
        "crn:1100000001",
        "agreement:fptt000000001",
      ],
    });
  });

  it("links every member of a series by every member's ref", async () => {
    await applications().insertMany([
      application("ref-1"),
      application("ref-2"),
      application("ref-3"),
      application("ref-9"),
      application("ref-1", { code: "other-grant" }),
    ]);
    await db.collection("application_series").insertMany([
      {
        code: "example-grant",
        clientRefs: ["ref-1", "ref-2", "ref-3"],
        latestClientRef: "ref-3",
      },
      {
        code: "example-grant",
        clientRefs: ["ref-9"],
        latestClientRef: "ref-9",
      },
    ]);

    await stampApplicationFacts(db);

    const members = await applications()
      .find({ code: "example-grant", refs: "ref:ref-2" })
      .sort({ clientRef: 1 })
      .toArray();

    expect(members.map(({ clientRef }) => clientRef)).toEqual([
      "ref-1",
      "ref-2",
      "ref-3",
    ]);
    expect((await byRef("ref-9")).refs).not.toContain("ref:ref-2");
    expect(
      await applications().findOne({ clientRef: "ref-1", code: "other-grant" }),
    ).toMatchObject({ refs: expect.not.arrayContaining(["ref:ref-2"]) });
  });

  it("is safe to run again", async () => {
    await applications().insertMany([
      application("ref-1"),
      application("ref-2"),
    ]);
    await db.collection("application_series").insertOne({
      code: "example-grant",
      clientRefs: ["ref-1", "ref-2"],
      latestClientRef: "ref-2",
    });

    await stampApplicationFacts(db);
    const before = await applications().find().toArray();
    await stampApplicationFacts(db);

    expect(await applications().find().toArray()).toEqual(before);
  });
});

describe("build bucket indexes", () => {
  const keysOf = async (name) =>
    (await db.collection(name).indexes()).map(({ key }) =>
      Object.keys(key).join(","),
    );

  it("builds every declared key and keeps the indexes that were there", async () => {
    await db
      .collection("outbox")
      .createIndex({ status: 1, claimedBy: 1 }, { name: "poller" });
    await db
      .collection("inbox")
      .createIndex({ publicationDate: -1, _id: -1 }, { name: "list" });
    await db
      .collection("applications")
      .createIndex({ clientRef: 1, code: 1 }, { unique: true });

    await buildBucketIndexes(db);

    expect(await keysOf("outbox")).toEqual([
      "_id",
      "status,claimedBy",
      "eventType,publicationDate,_id",
      "eventType,status,publicationDate,_id",
      "eventType,status,lastError.name,publicationDate,_id",
      "eventType,status,errorKey,publicationDate,_id",
      "eventType,refs,publicationDate,_id",
    ]);
    expect(await keysOf("inbox")).toEqual([
      "_id",
      "publicationDate,_id",
      "status,publicationDate,_id",
      "status,eventType,publicationDate,_id",
      "status,lastError.name,publicationDate,_id",
      "status,errorKey,eventType,publicationDate,_id",
      "refs,publicationDate,_id",
    ]);
    expect(await keysOf("applications")).toEqual([
      "_id",
      "clientRef,code",
      "createdAt,_id",
      "code,createdAt,_id",
      "refs,createdAt,_id",
    ]);
    expect((await db.collection("inbox").indexes())[1].name).toBe("list");
  });

  it("builds nothing the second time", async () => {
    await buildBucketIndexes(db);
    const before = await keysOf("outbox");

    await buildBucketIndexes(db);

    expect(await keysOf("outbox")).toEqual(before);
  });
});
