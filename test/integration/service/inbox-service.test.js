import { MongoClient } from "mongodb";
import { randomUUID } from "node:crypto";
import { env } from "node:process";
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
import { Inbox } from "../../../src/grants/models/inbox.js";
import { claimEvents } from "../../../src/grants/repositories/inbox.repository.js";
import { InboxSubscriber } from "../../../src/grants/subscribers/inbox.subscriber.js";
let client;
let inbox, fifo;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  const db = client.db(env.MONGO_DATABASE);
  inbox = db.collection("inbox");
  fifo = db.collection("fifo_locks");
  await fifo.deleteMany({});
  await inbox.deleteMany({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await client?.close();
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

// Polls a condition to a ceiling, returning as soon as it holds. A fixed sleep
// is either too short on a slow machine or wasted time on a fast one.
const waitFor = async (condition, { timeoutMs = 5000, stepMs = 20 } = {}) => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (condition()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
};

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
    // Waits for the first poll to land, with a ceiling generous enough for a
    // loaded machine rather than one tuned to a fast one. The subscriber does
    // real work on the way here - a `findNextMessage` query, a fifo lock and a
    // claim - and the old budget was ten 20ms ticks, which a busy CI runner
    // regularly missed: the assertion then read "called 0 times" and the
    // failure looked like the subscriber, not the clock. It still exits the
    // moment the call arrives, so nothing is slower when nothing is wrong,
    // and it still stops after ONE poll, which is what keeps the
    // `getNextAvailable` count below meaningful.
    await waitFor(() => processEventsSpy.mock.calls.length > 0);
    subscriber.stop();
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
    for (let i = 0; i < 10 && processEventsSpy.mock.calls.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    subscriber.stop();
    expect(processEventsSpy).toHaveBeenCalledTimes(1);
    const [events] = processEventsSpy.mock.calls[0];
    expect(events).toHaveLength(1);
    expect(events[0]._id).toBe("6");
    expect(events[0].segregationRef).toBe("ref_4");
  });
});
