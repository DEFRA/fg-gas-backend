import { beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../logger.js";
import { indexKeysOf, keyOf } from "./bucket.js";
import { checkDeclaredIndexes } from "./indexes.js";
import { ledBucket, testBucket } from "./test-bucket.js";

vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const outbox = testBucket({
  indexes: [["status"], ["eventType", "status"], ["code"]],
});
const inbox = testBucket({
  id: "test.inbox",
  path: "test/inbox",
  collection: "inbox",
  indexes: [["status"], ["code"]],
});

const STATUS_KEY = keyOf(outbox, ["status"]);
const EVENT_TYPE_KEY = keyOf(outbox, ["eventType", "status"]);

const without = (bucket, dropped) =>
  indexKeysOf(bucket).filter(
    (key) => JSON.stringify(key) !== JSON.stringify(dropped),
  );

const fakeCollection = ({
  keys,
  stored = {},
  indexes = async () => keys.map((key) => ({ key })),
  distinct = async (fact) => stored[fact] ?? [],
}) => ({
  indexes: vi.fn(indexes),
  distinct: vi.fn(distinct),
});

const fakeDatabase = (collections) => ({
  collection: (name) => collections[name],
});

const errors = () => logger.error.mock.calls.map((call) => call.at(-1));
const warnings = () => logger.warn.mock.calls.map(([message]) => message);

describe("checkDeclaredIndexes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logs nothing when every declared index and stored value is there", async () => {
    const outboxCollection = fakeCollection({
      keys: indexKeysOf(outbox),
      stored: {
        status: ["PUBLISHED", "DEAD_LETTER", null],
        eventType: ["case.create"],
      },
    });

    await checkDeclaredIndexes(fakeDatabase({ outbox: outboxCollection }), [
      outbox,
    ]);

    expect(logger.error).not.toHaveBeenCalled();
    expect(outboxCollection.indexes).toHaveBeenCalledWith({
      maxTimeMS: 10_000,
    });
    expect(outboxCollection.distinct.mock.calls).toEqual([
      ["status", {}, { maxTimeMS: 10_000 }],
      ["eventType", {}, { maxTimeMS: 10_000 }],
    ]);
  });

  it("reads no values of a fact that leads no line, or whose values are stored", async () => {
    const inboxCollection = fakeCollection({ keys: indexKeysOf(inbox) });

    await checkDeclaredIndexes(fakeDatabase({ inbox: inboxCollection }), [
      inbox,
    ]);

    expect(inboxCollection.distinct.mock.calls.map(([fact]) => fact)).toEqual([
      "status",
    ]);
    expect(warnings()).toEqual([
      "Bucket test.inbox eventType values are not checked: it leads no usable index",
      "Bucket test.inbox source values are not checked: it leads no usable index",
    ]);
  });

  it("checks a fact on any built line it leads", async () => {
    const twoLines = testBucket({
      indexes: [["eventType"], ["eventType", "status"], ["status"], ["code"]],
    });
    const collection = fakeCollection({
      keys: without(twoLines, keyOf(twoLines, ["eventType"])),
      stored: { eventType: ["case.create", "case.lost"] },
    });

    await checkDeclaredIndexes(fakeDatabase({ outbox: collection }), [
      twoLines,
    ]);

    expect(errors()).toEqual([
      "Bucket test.outbox is missing index eventType_1_publicationDate_-1__id_-1",
      'Bucket test.outbox holds eventType values it doesn\'t declare: "case.lost"',
    ]);
  });

  it("checks a bucket's lead, not the first fact of its lines", async () => {
    const led = ledBucket({ indexes: [["status"], ["grantCode"]] });
    const collection = fakeCollection({
      keys: indexKeysOf(led),
      stored: { eventType: ["case.create", "case.lost"] },
    });

    await checkDeclaredIndexes(fakeDatabase({ outbox: collection }), [led]);

    expect(collection.distinct.mock.calls.map(([fact]) => fact)).toEqual([
      "eventType",
    ]);
    expect(errors()).toEqual([
      'Bucket test.outbox holds eventType values it doesn\'t declare: "case.lost"',
    ]);
    expect(warnings()).toContain(
      "Bucket test.outbox status values are not checked: it leads no usable index",
    );
  });

  it.each([
    ["hidden", { hidden: true }],
    ["partial", { partialFilterExpression: { status: { $exists: true } } }],
    ["sparse", { sparse: true }],
    ["collated", { collation: { locale: "en" } }],
  ])(
    "logs a %s index as not plain, and reads no values on it",
    async (_, options) => {
      const collection = fakeCollection({
        indexes: async () =>
          indexKeysOf(outbox).map((key) =>
            JSON.stringify(key) === JSON.stringify(STATUS_KEY)
              ? { key, ...options }
              : { key },
          ),
      });

      await checkDeclaredIndexes(fakeDatabase({ outbox: collection }), [
        outbox,
      ]);

      expect(errors()).toEqual([
        "Bucket test.outbox index status_1_publicationDate_-1__id_-1 is not a plain index",
      ]);
      expect(collection.distinct.mock.calls.map(([fact]) => fact)).toEqual([
        "eventType",
      ]);
      expect(warnings()).toContain(
        "Bucket test.outbox status values are not checked: it leads no usable index",
      );
    },
  );

  it("logs a stored value of another type than the one declared", async () => {
    const numbered = testBucket({
      facts: {
        ...outbox.facts,
        status: {
          label: "Status",
          param: "status",
          values: [{ value: 1, label: "One" }],
        },
      },
    });

    await checkDeclaredIndexes(
      fakeDatabase({
        outbox: fakeCollection({
          keys: indexKeysOf(numbered),
          stored: { status: [1, "1"] },
        }),
      }),
      [numbered],
    );

    expect(errors()).toEqual([
      'Bucket test.outbox holds status values it doesn\'t declare: "1"',
    ]);
  });

  it("logs each missing index by name", async () => {
    const keys = without(outbox, EVENT_TYPE_KEY);

    await checkDeclaredIndexes(
      fakeDatabase({ outbox: fakeCollection({ keys }) }),
      [outbox],
    );

    expect(errors()).toEqual([
      "Bucket test.outbox is missing index eventType_1_status_1_publicationDate_-1__id_-1",
    ]);
  });

  it("reads no values of a fact whose leading index is missing", async () => {
    const keys = without(outbox, STATUS_KEY);
    const outboxCollection = fakeCollection({ keys });

    await checkDeclaredIndexes(fakeDatabase({ outbox: outboxCollection }), [
      outbox,
    ]);

    expect(outboxCollection.distinct).not.toHaveBeenCalledWith(
      "status",
      expect.anything(),
      expect.anything(),
    );
    expect(outboxCollection.distinct).toHaveBeenCalledWith(
      "eventType",
      {},
      { maxTimeMS: 10_000 },
    );
    expect(errors()).toEqual([
      "Bucket test.outbox is missing index status_1_publicationDate_-1__id_-1",
    ]);
  });

  it("logs stored values a fact doesn't declare", async () => {
    await checkDeclaredIndexes(
      fakeDatabase({
        outbox: fakeCollection({
          keys: indexKeysOf(outbox),
          stored: {
            status: ["PUBLISHED", "LOST", "GONE"],
            eventType: ["case.create", null],
          },
        }),
      }),
      [outbox],
    );

    expect(errors()).toEqual([
      `Bucket test.outbox holds status values it doesn't declare: "LOST", "GONE"`,
    ]);
  });

  it("logs every index missing from a collection not yet created", async () => {
    const missing = Object.assign(new Error("ns does not exist"), {
      code: 26,
    });

    await checkDeclaredIndexes(
      fakeDatabase({
        inbox: fakeCollection({
          indexes: async () => {
            throw missing;
          },
        }),
      }),
      [inbox],
    );

    expect(errors()).toEqual([
      "Bucket test.inbox is missing index publicationDate_-1__id_-1",
      "Bucket test.inbox is missing index status_1_publicationDate_-1__id_-1",
      "Bucket test.inbox is missing index code_1_publicationDate_-1__id_-1",
      "Bucket test.inbox is missing index refs_1_publicationDate_-1__id_-1",
    ]);
  });

  it.each([
    [
      "its indexes",
      {
        indexes: async () => {
          throw new Error("down");
        },
      },
    ],
    [
      "its values",
      {
        keys: indexKeysOf(outbox),
        distinct: async () => {
          throw new Error("down");
        },
      },
    ],
  ])(
    "logs a bucket whose %s can't be read, and still checks the others",
    async (_, failing) => {
      const outboxCollection = fakeCollection(failing);
      const inboxCollection = fakeCollection({
        keys: indexKeysOf(inbox).slice(1),
      });

      await expect(
        checkDeclaredIndexes(
          fakeDatabase({ outbox: outboxCollection, inbox: inboxCollection }),
          [outbox, inbox],
        ),
      ).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ message: "down" }),
        "Declared index check failed for bucket test.outbox",
      );
      expect(errors()).toContain(
        "Bucket test.inbox is missing index publicationDate_-1__id_-1",
      );
    },
  );

  it("checks one bucket after another, then says it has checked them", async () => {
    const order = [];
    const tracked = (name, keys) =>
      fakeCollection({
        indexes: async () => {
          order.push(`${name} started`);
          await Promise.resolve();
          order.push(`${name} done`);

          return keys.map((key) => ({ key }));
        },
      });

    await checkDeclaredIndexes(
      fakeDatabase({
        outbox: tracked("outbox", indexKeysOf(outbox)),
        inbox: tracked("inbox", indexKeysOf(inbox)),
      }),
      [outbox, inbox],
    );

    expect(order).toEqual([
      "outbox started",
      "outbox done",
      "inbox started",
      "inbox done",
    ]);
    expect(logger.info).toHaveBeenCalledExactlyOnceWith(
      "Checked declared indexes and stored values of 2 of 2 buckets",
    );
  });

  it("never rejects, even when every collection does", async () => {
    const rejecting = fakeCollection({
      indexes: async () => {
        throw new Error("down");
      },
    });

    await expect(
      checkDeclaredIndexes(
        fakeDatabase({ outbox: rejecting, inbox: rejecting }),
        [outbox, inbox],
      ),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledExactlyOnceWith(
      "Checked declared indexes and stored values of 0 of 2 buckets",
    );
  });
});
