import { ObjectId } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

let replSet;
let mongoClient;
let db;
let inboxRepository;
let outboxRepository;
let Inbox;
let markPermanentFailure;

const MS_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  vi.stubEnv("MONGO_URI", replSet.getUri());
  vi.stubEnv("MONGO_DATABASE", "event-history-test");
  vi.resetModules();

  ({ mongoClient, db } = await import("../../common/mongo-client.js"));
  inboxRepository = await import("./inbox.repository.js");
  outboxRepository = await import("./outbox.repository.js");
  ({ Inbox } = await import("../models/inbox.js"));
  ({ markPermanentFailure } = await import("../retryable.js"));

  await mongoClient.connect();
}, 120_000);

afterAll(async () => {
  await mongoClient?.close();
  await replSet?.stop();
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  await db.collection("inbox").deleteMany({});
  await db.collection("outbox").deleteMany({});
});

const anAttempt = (n) => ({
  at: new Date(Date.UTC(2026, 5, 16, 10, 0, n)).toISOString(),
  name: "Error",
  message: `attempt ${n}`,
  stack: null,
});

const DEATH = { kind: "dead-lettered", at: "2026-06-16T10:00:02.000Z" };

const aDeadLetter = (overrides = {}) => ({
  _id: new ObjectId(),
  source: "CW",
  type: "cloud.defra.local.fg-cw-backend.case.status.updated",
  messageId: "msg-1",
  segregationRef: "SEG-1",
  publicationDate: "2026-06-16T10:00:00.000Z",
  eventTime: "2026-06-16T10:00:00.000Z",
  status: "DEAD_LETTER",
  completionAttempts: 5,
  attemptHistory: [anAttempt(1), anAttempt(2)],
  lastResubmissionDate: DEATH.at,
  history: [DEATH],
  event: { id: "evt-1", time: "2026-06-16T10:00:00.000Z", data: { a: 0 } },
  claimedBy: null,
  ...overrides,
});

const BOXES = [
  { name: "inbox", repository: () => inboxRepository },
  { name: "outbox", repository: () => outboxRepository },
];

describe.each(BOXES)("$name history against Mongo", ({ name, repository }) => {
  const collection = () => db.collection(name);
  const stored = (doc) => collection().findOne({ _id: doc._id });
  const insert = async (overrides) => {
    const doc = aDeadLetter(overrides);
    await collection().insertOne(doc);
    return doc;
  };

  it("keeps the attempts through a redrive and appends the redrive", async () => {
    const doc = await insert();

    await repository().redriveById(doc._id.toHexString(), { by: "Ada" });

    const after = await stored(doc);

    expect(after.attemptHistory).toEqual(doc.attemptHistory);
    expect(after.completionAttempts).toBe(0);
    expect(after.history).toEqual([
      DEATH,
      { kind: "redriven", at: after.lastRedrive.at, by: "Ada" },
    ]);
    expect(after.history[1].at).toMatch(MS_ISO);
  });

  it("appends a purge, as the record it stores", async () => {
    const doc = await insert();

    await repository().purgeById(doc._id.toHexString(), {
      by: "Ada",
      reasonCode: "OTHER",
      note: "sent twice",
    });

    const after = await stored(doc);

    expect(after.history).toEqual([
      DEATH,
      { kind: "purged", ...after.lastPurge },
    ]);
  });

  it("appends a death from the dead-letter sweep", async () => {
    const doc = await insert({ status: "RESUBMITTED", history: [] });

    await repository().updateDeadEvents();

    const [entry] = (await stored(doc)).history;

    expect(entry.kind).toBe("dead-lettered");
    expect(entry.at).toMatch(MS_ISO);
  });

  it("appends one death from a missing segregation ref, however often it is called", async () => {
    const doc = await insert({
      status: "PUBLISHED",
      completionAttempts: 0,
      history: [],
    });

    await repository().deadLetterEvent(doc);
    await repository().deadLetterEvent(doc);

    const after = await stored(doc);

    expect(after.status).toBe("DEAD_LETTER");
    expect(after.history.map(({ kind }) => kind)).toEqual(["dead-lettered"]);
  });

  it("keeps only the 25 newest attempts, across redrives", async () => {
    const doc = await insert({
      status: "PROCESSING",
      claimExpiresAt: new Date(0),
      attemptHistory: Array.from({ length: 25 }, (_, n) => anAttempt(n)),
    });

    await repository()[
      name === "inbox" ? "processExpiredEvents" : "updateExpiredEvents"
    ]();

    const { attemptHistory } = await stored(doc);

    expect(attemptHistory).toHaveLength(25);
    expect(attemptHistory.at(0).message).toBe("attempt 1");
    expect(attemptHistory.at(-1).name).toBe("ClaimExpired");
  });

  describe("payload edits", () => {
    const editsOf = async (doc) =>
      (await stored(doc)).history.filter(
        ({ kind }) => kind === "payload-edited",
      );

    const edit = (doc, revision, data) =>
      repository().editPayloadById(doc._id.toHexString(), {
        revision,
        event: { ...doc.event, data },
        original: revision === 0 ? doc.event : undefined,
        by: "Ada",
        note: `edit ${revision + 1}`,
      });

    it("keeps each edit's payload before it, and a payload's `$` text as text", async () => {
      const doc = await insert();

      await edit(doc, 0, { price: "$5" });
      await edit(doc, 1, { price: "$6" });

      const { event } = await stored(doc);
      const history = await editsOf(doc);

      expect(event.data).toEqual({ price: "$6" });
      expect(history.map(({ before }) => before.data)).toEqual([
        { a: 0 },
        { price: "$5" },
      ]);
      expect(history[1]).toMatchObject({
        kind: "payload-edited",
        by: "Ada",
        note: "edit 2",
      });
    });

    it("drops the before-image of every edit past the 5 newest", async () => {
      const doc = await insert();

      for (let revision = 0; revision < 7; revision++) {
        await edit(doc, revision, { a: revision + 1 });
      }

      const history = await editsOf(doc);

      expect(history).toHaveLength(7);
      expect(history.map((entry) => "before" in entry)).toEqual([
        false,
        false,
        true,
        true,
        true,
        true,
        true,
      ]);
      expect(history.at(2).before.data).toEqual({ a: 2 });
      expect(history.at(0)).toMatchObject({ by: "Ada", note: "edit 1" });
    });
  });

  describe("a row written before the history", () => {
    const LEGACY_EDIT = { at: anAttempt(3).at, by: "Bo", note: "fixed a" };
    const ORIGINAL = { id: "evt-1", data: { a: -1 } };

    const aLegacyRow = async (overrides) => {
      const doc = Object.fromEntries(
        Object.entries(
          aDeadLetter({
            history: undefined,
            lastEdit: LEGACY_EDIT,
            originalPayload: ORIGINAL,
            payloadRevision: 1,
            ...overrides,
          }),
        ).filter(([, value]) => value !== undefined),
      );
      await collection().insertOne(doc);
      return doc;
    };

    it("stores its last edit and its death before the first new edit replaces them", async () => {
      const doc = await aLegacyRow();

      await repository().editPayloadById(doc._id.toHexString(), {
        revision: 1,
        event: { ...doc.event, data: { a: 1 } },
        by: "Ada",
        note: "again",
      });

      const { history, lastEdit } = await stored(doc);

      expect(history).toEqual([
        DEATH,
        { kind: "payload-edited", ...LEGACY_EDIT, before: ORIGINAL },
        {
          kind: "payload-edited",
          ...lastEdit,
          before: doc.event,
        },
      ]);
    });

    it("stores no before-image for its last edit once other changes followed", async () => {
      const doc = await aLegacyRow({ payloadRevision: 2 });

      await repository().redriveById(doc._id.toHexString(), { by: "Ada" });

      const legacyEdit = (await stored(doc)).history.find(
        ({ kind }) => kind === "payload-edited",
      );

      expect(legacyEdit).toEqual({ kind: "payload-edited", ...LEGACY_EDIT });
    });

    it("stores its last redrive and purge before a redrive replaces them, oldest first", async () => {
      const lastRedrive = { at: anAttempt(4).at, by: null };
      const lastPurge = {
        at: anAttempt(5).at,
        by: "Bo",
        reasonCode: "OTHER",
        note: "gone",
      };
      const doc = await aLegacyRow({
        status: "PURGED",
        lastEdit: undefined,
        lastRedrive,
        lastPurge,
      });

      await repository().redriveById(doc._id.toHexString(), { by: "Ada" });

      const after = await stored(doc);

      expect(after.history).toEqual([
        DEATH,
        { kind: "redriven", ...lastRedrive },
        { kind: "purged", ...lastPurge },
        { kind: "redriven", ...after.lastRedrive },
      ]);
    });

    it("stores a death since the last redrive past an earlier stored one", async () => {
      const lastRedrive = { at: "2026-06-16T10:00:01.000Z", by: "Ada" };
      const earlier = { kind: "dead-lettered", at: "2026-06-16T10:00:00.500Z" };
      const doc = await aLegacyRow({
        lastEdit: undefined,
        lastRedrive,
        history: [earlier, { kind: "redriven", ...lastRedrive }],
      });

      await repository().redriveById(doc._id.toHexString(), { by: "Ada" });

      const deaths = (await stored(doc)).history.filter(
        ({ kind }) => kind === "dead-lettered",
      );

      expect(deaths).toEqual([earlier, DEATH]);
    });

    it("stores an older pod's records in their place among newer stored ones", async () => {
      const redrive = { kind: "redriven", at: anAttempt(4).at, by: "Ada" };
      const doc = await aLegacyRow({ history: [redrive] });

      await repository().purgeById(doc._id.toHexString(), {
        by: "Ada",
        reasonCode: "OTHER",
        note: "sent twice",
      });

      const at = (await stored(doc)).history.map(({ kind, at }) => [kind, at]);

      expect(at).toEqual([
        ["dead-lettered", DEATH.at],
        ["payload-edited", LEGACY_EDIT.at],
        ["redriven", redrive.at],
        ["purged", expect.stringMatching(MS_ISO)],
      ]);
    });

    it("stores an older pod's redrive before a newer stored death", async () => {
      const lastRedrive = { at: anAttempt(1).at, by: "Bo" };
      const doc = await aLegacyRow({
        lastEdit: undefined,
        lastRedrive,
        history: [DEATH],
      });

      await repository().redriveById(doc._id.toHexString(), { by: "Ada" });

      const after = await stored(doc);

      expect(after.history).toEqual([
        { kind: "redriven", ...lastRedrive },
        DEATH,
        { kind: "redriven", ...after.lastRedrive },
      ]);
    });

    it("leaves a row with nothing to derive in its stored order", async () => {
      const redrive = { kind: "redriven", at: anAttempt(5).at, by: "Ada" };
      const doc = await aLegacyRow({
        lastEdit: undefined,
        history: [redrive, DEATH],
      });

      await repository().purgeById(doc._id.toHexString(), {
        by: "Ada",
        reasonCode: "OTHER",
        note: "sent twice",
      });

      const kinds = (await stored(doc)).history.map(({ kind }) => kind);

      expect(kinds).toEqual(["redriven", "dead-lettered", "purged"]);
    });

    it("stores each last record once", async () => {
      const doc = await aLegacyRow();

      await repository().redriveById(doc._id.toHexString(), { by: "Ada" });
      await repository().deadLetterEvent(doc);
      await repository().purgeById(doc._id.toHexString(), {
        by: "Ada",
        reasonCode: "OTHER",
        note: "sent twice",
      });

      const kinds = (await stored(doc)).history.map(({ kind }) => kind);

      expect(kinds).toEqual([
        "dead-lettered",
        "payload-edited",
        "redriven",
        "dead-lettered",
        "purged",
      ]);
    });
  });

  // Each write appends on the server, so none reads the history it adds to.
  it("loses no entry to writes racing on one row", async () => {
    const doc = await insert({ history: [] });
    const entry = (n) => ({
      kind: "redriven",
      at: anAttempt(n).at,
      by: `${n}`,
    });
    const writes = Array.from({ length: 40 }, (_, n) =>
      n % 2 === 0
        ? collection().updateOne({ _id: doc._id }, [
            {
              $set: {
                history: {
                  $concatArrays: [
                    { $ifNull: ["$history", []] },
                    [{ $literal: entry(n) }],
                  ],
                },
              },
            },
          ])
        : collection().updateOne(
            { _id: doc._id },
            { $push: { history: entry(n) } },
          ),
    );

    await Promise.all(writes);

    expect((await stored(doc)).history).toHaveLength(40);
  });
});

describe("inbox history through a model save", () => {
  const claimed = async () => {
    const doc = aDeadLetter({
      status: "PROCESSING",
      completionAttempts: 0,
      claimedBy: "claim-1",
      history: [{ kind: "redriven", at: "2026-06-16T11:00:00.000Z", by: null }],
    });
    await db.collection("inbox").insertOne(doc);
    return doc;
  };

  it("appends the death a save records to the history a model never held", async () => {
    const doc = await claimed();
    const inbox = Inbox.fromDocument(doc);

    inbox.markAsFailed(markPermanentFailure(new Error("bad definition")));
    await inboxRepository.update(inbox, "claim-1");

    const after = await db.collection("inbox").findOne({ _id: doc._id });

    expect(after.status).toBe("DEAD_LETTER");
    expect(after.history).toEqual([
      ...doc.history,
      { kind: "dead-lettered", at: after.lastResubmissionDate },
    ]);
  });

  it("leaves the history alone on a completion", async () => {
    const doc = await claimed();
    const inbox = Inbox.fromDocument(doc);

    inbox.markAsComplete();
    await inboxRepository.update(inbox, "claim-1");

    const after = await db.collection("inbox").findOne({ _id: doc._id });

    expect(after.status).toBe("COMPLETED");
    expect(after.history).toEqual(doc.history);
  });

  it("keeps an entry written after the model was read", async () => {
    const doc = await claimed();
    const inbox = Inbox.fromDocument(doc);
    const meanwhile = { kind: "purged", at: "2026-06-16T11:01:00.000Z" };
    await db
      .collection("inbox")
      .updateOne({ _id: doc._id }, { $push: { history: meanwhile } });

    inbox.markAsFailed(markPermanentFailure(new Error("bad definition")));
    await inboxRepository.update(inbox, "claim-1");

    const after = await db.collection("inbox").findOne({ _id: doc._id });

    expect(after.history.map(({ kind }) => kind)).toEqual([
      "redriven",
      "purged",
      "dead-lettered",
    ]);
  });
});
