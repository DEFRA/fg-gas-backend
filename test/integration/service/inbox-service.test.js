import { MongoClient, ObjectId } from "mongodb";
import { randomUUID } from "node:crypto";
import { env } from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
// Its own database, so the running service's poller cannot claim the fixtures.
// The setup files have already loaded config, hence the module reset.
const DATABASE = "fg-gas-backend-inbox-service-test";
vi.stubEnv("MONGO_DATABASE", DATABASE);
vi.resetModules();

const { Inbox } = await import("../../../src/events/models/inbox.js");
const {
  claimEvents,
  processExpiredEvents,
  redriveById,
  update,
  updateDeadEvents,
} = await import("../../../src/events/repositories/inbox.repository.js");
const { clearEventHandlers, registerEventHandler } =
  await import("../../../src/events/services/event-handlers.js");
const { config } = await import("../../../src/common/config.js");
const { logger } = await import("../../../src/common/logger.js");
const { InboxSubscriber } =
  await import("../../../src/events/subscribers/inbox.subscriber.js");
const { db: serviceDb, mongoClient } =
  await import("../../../src/common/mongo-client.js");

let client;
let db;
let inbox, fifo;

beforeAll(async () => {
  expect(serviceDb.databaseName).toBe(DATABASE);
  client = await MongoClient.connect(env.MONGO_URI);
  db = client.db(DATABASE);
  inbox = db.collection("inbox");
  fifo = db.collection("fifo_locks");
  await fifo.deleteMany({});
  await inbox.deleteMany({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await db?.dropDatabase();
  await client?.close();
  await mongoClient.close();
  vi.unstubAllEnvs();
});

const createMockInbox = (id, time, segregationRef) => {
  return Inbox.createMock({
    _id: id,
    segregationRef,
    event: {
      time,
    },
  });
};

describe("inbox repository claim events", () => {
  beforeEach(async () => {
    await fifo.deleteMany({});
    await inbox.deleteMany({});
    await fifo.insertOne({
      segregationRef: "ref_1",
      locked: true,
      lockedAt: new Date(Date.now()),
      actor: "INBOX",
    });
  });

  it("should claim events in order", async () => {
    await inbox.insertMany([
      createMockInbox("2", new Date(Date.now() - 3000).toISOString(), "ref_1"),
      createMockInbox("3", new Date(Date.now() - 2000).toISOString(), "ref_1"),
      createMockInbox("4", new Date(Date.now() - 1000).toISOString(), "ref_1"),
      createMockInbox("1", new Date(Date.now() - 4000).toISOString(), "ref_1"),
    ]);

    const records = await claimEvents(randomUUID(), "ref_1", 4);
    expect(records).toHaveLength(4);
    expect(records[0]._id).toBe("1");
    expect(records[1]._id).toBe("2");
    expect(records[2]._id).toBe("3");
    expect(records[3]._id).toBe("4");
  });
});

describe("getNextAvailable", () => {
  beforeEach(async () => {
    await fifo.deleteMany({});
    await inbox.deleteMany({});
    await fifo.insertOne({
      segregationRef: "ref_1",
      locked: true,
      lockedAt: new Date(Date.now()),
      actor: "INBOX",
    });
  });

  it("should DLQ events with no segregationRef", async () => {
    await inbox.deleteMany({});
    const inbox1 = createMockInbox(
      "1",
      new Date(Date.now()).toISOString(),
      "ref_1",
    );
    const inbox2 = createMockInbox(
      "2",
      new Date(Date.now()).toISOString(),
      "ref_2",
    );
    inbox1.segregationRef = null;
    await inbox.insertMany([inbox1, inbox2]);
    const getNextAvailableSpy = vi.spyOn(
      InboxSubscriber.prototype,
      "getNextAvailable",
    );
    const processEventsSpy = vi
      .spyOn(InboxSubscriber.prototype, "processEvents")
      .mockResolvedValue(true);
    const subscriber = new InboxSubscriber(1000);
    subscriber.start();
    try {
      await vi.waitFor(() => expect(processEventsSpy).toHaveBeenCalled(), {
        timeout: 5000,
        interval: 20,
      });
    } finally {
      subscriber.stop();
    }
    expect(processEventsSpy).toHaveBeenCalledTimes(1);
    expect(getNextAvailableSpy).toHaveBeenCalledTimes(2);
    const [events] = processEventsSpy.mock.calls[0];
    expect(events).toHaveLength(1);
    expect(events[0]._id).toBe("2");
    expect(events[0].segregationRef).toBe("ref_2");
  });
});

describe("inbox fifo", () => {
  beforeEach(async () => {
    await fifo.deleteMany({});
    await inbox.deleteMany({});
    await fifo.insertOne({
      segregationRef: "ref_1",
      locked: true,
      lockedAt: new Date(Date.now()),
      actor: "INBOX",
    });

    await inbox.insertMany([
      createMockInbox("2", new Date(Date.now() - 3000).toISOString(), "ref_1"),
      createMockInbox("4", new Date(Date.now() - 1000).toISOString(), "ref_1"),
      createMockInbox("1", new Date(Date.now() - 4000).toISOString(), "ref_2"),
      createMockInbox("3", new Date(Date.now() - 2000).toISOString(), "ref_2"),
      createMockInbox("5", new Date(Date.now() - 4000).toISOString(), "ref_3"),
      createMockInbox("6", new Date(Date.now() - 6000).toISOString(), "ref_4"), // should select this one. Oldest record with no lock.
    ]);
  });

  it("should claim unlocked events", async () => {
    const processEventsSpy = vi
      .spyOn(InboxSubscriber.prototype, "processEvents")
      .mockResolvedValue(true);

    vi.spyOn(
      InboxSubscriber.prototype,
      "processResubmittedEvents",
    ).mockResolvedValue(true);

    vi.spyOn(
      InboxSubscriber.prototype,
      "processFailedEvents",
    ).mockResolvedValue(true);

    vi.spyOn(InboxSubscriber.prototype, "processDeadEvents").mockResolvedValue(
      true,
    );

    const subscriber = new InboxSubscriber(1000);
    subscriber.start();
    try {
      await vi.waitFor(() => expect(processEventsSpy).toHaveBeenCalled(), {
        timeout: 5000,
        interval: 20,
      });
    } finally {
      subscriber.stop();
    }
    expect(processEventsSpy).toHaveBeenCalledTimes(1);
    const [events] = processEventsSpy.mock.calls[0];
    expect(events).toHaveLength(1);
    expect(events[0]._id).toBe("6");
    expect(events[0].segregationRef).toBe("ref_4");
  });
});

// A handler that outlives its claim still holds the whole row in memory, and
// its final write would put that copy back over whatever happened since.
describe("inbox final write is fenced on the claim", () => {
  const TYPE = "claim-fence.test";
  const REF = "claim_fence_ref";

  const aPublishedRow = () =>
    Inbox.createMock({
      _id: new ObjectId(),
      messageId: `fence-${randomUUID()}`,
      type: TYPE,
      segregationRef: REF,
      completionAttempts: 0,
    });

  const insert = async (row, overrides = {}) =>
    inbox.insertOne({ ...row.toDocument(), ...overrides });

  const theRow = (row) => inbox.findOne({ _id: row._id });

  const expireAndSweep = async (row) => {
    await inbox.updateOne(
      { _id: row._id },
      { $set: { claimExpiresAt: new Date(Date.now() - 1000) } },
    );
    await processExpiredEvents();
  };

  beforeEach(async () => {
    await fifo.deleteMany({});
    await inbox.deleteMany({});
  });

  afterEach(() => {
    clearEventHandlers();
  });

  it("writes nothing with a stale token", async () => {
    const row = aPublishedRow();
    await insert(row);
    const [claimed] = await claimEvents("live-token", REF);
    const before = await theRow(row);

    claimed.markAsComplete();
    const result = await update(claimed, "stale-token");

    expect(result.matchedCount).toBe(0);
    expect(await theRow(row)).toEqual(before);
  });

  it("completes the row with the live token", async () => {
    const row = aPublishedRow();
    await insert(row);
    registerEventHandler(TYPE, async () => {});

    await new InboxSubscriber().processWithLock(randomUUID(), REF);

    const stored = await theRow(row);
    expect(stored.status).toBe("COMPLETED");
    expect(stored.claimedBy).toBeNull();
  });

  it("leaves a row reclaimed mid-handler as the expiry sweep left it", async () => {
    const row = aPublishedRow();
    await insert(row);
    const warn = vi.spyOn(logger, "warn");
    let swept;
    registerEventHandler(TYPE, async () => {
      await expireAndSweep(row);
      swept = await theRow(row);
    });

    await new InboxSubscriber().processWithLock(randomUUID(), REF);

    expect(swept.status).toBe("FAILED");
    expect(await theRow(row)).toEqual(swept);
    expect(warn).toHaveBeenCalledWith(
      `Inbox event ${row.messageId} was reclaimed before its handler finished`,
    );
  });

  it("the running poller sweeps an expired claim to FAILED and retries it", async () => {
    const row = aPublishedRow();
    await insert(row, {
      status: "PROCESSING",
      claimedBy: "a-pod-that-died",
      claimedAt: new Date(Date.now() - 600_000),
      claimExpiresAt: new Date(Date.now() - 60_000),
    });
    const handled = vi.fn();
    registerEventHandler(TYPE, handled);
    const subscriber = new InboxSubscriber();

    subscriber.start();
    try {
      await vi.waitFor(
        async () => expect((await theRow(row)).status).toBe("COMPLETED"),
        { timeout: 10_000, interval: 100 },
      );
    } finally {
      subscriber.stop();
      await sleep(subscriber.interval * 2);
    }

    const stored = await theRow(row);
    expect(handled).toHaveBeenCalledTimes(1);
    expect(stored.claimedBy).toBeNull();
    expect(stored.completionAttempts).toBe(1);
    expect(stored.attemptHistory.at(-1).name).toBe("ClaimExpired");
  });

  it.each([
    ["completes", async () => {}],
    [
      "fails",
      async () => {
        throw new Error("downstream timed out");
      },
    ],
  ])(
    "a handler that outlives its claim and then %s keeps a redrive made since",
    async (_, finish) => {
      const row = aPublishedRow();
      await insert(row, { completionAttempts: 1 });
      let redriven;
      registerEventHandler(TYPE, async () => {
        await expireAndSweep(row);
        await inbox.updateOne(
          { _id: row._id },
          { $set: { completionAttempts: config.inbox.inboxMaxRetries } },
        );
        await updateDeadEvents();
        redriven = await redriveById(row._id.toHexString(), {
          by: "operator",
        });
        await finish();
      });

      await new InboxSubscriber().processWithLock(randomUUID(), REF);

      expect(redriven).toBe(true);
      const stored = await theRow(row);
      expect({
        status: stored.status,
        lastRedriveBy: stored.lastRedrive?.by ?? null,
        completionAttempts: stored.completionAttempts,
      }).toEqual({
        status: "RESUBMITTED",
        lastRedriveBy: "operator",
        completionAttempts: 0,
      });
    },
  );
});
