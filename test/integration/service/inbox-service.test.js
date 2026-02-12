import { MongoClient } from "mongodb";
import { randomUUID } from "node:crypto";
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

describe("inbox claim events", () => {
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
