import { MongoClient } from "mongodb";
import { randomUUID } from "node:crypto";
import { env } from "node:process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Inbox } from "../../../src/grants/models/inbox.js";
import { claimEvents } from "../../../src/grants/repositories/inbox.repository.js";
let client;
let inbox;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  inbox = client.db().collection("inbox");
});

afterAll(async () => {
  await client?.close();
});

const createMockInbox = (id, time) => {
  return Inbox.createMock({
    _id: id,
    event: {
      time,
    },
  });
};

describe("inbox", () => {
  it("should claim events in order", async () => {
    await inbox.insertMany([
      createMockInbox("2", new Date(Date.now() - 3000).toISOString()),
      createMockInbox("3", new Date(Date.now() - 2000).toISOString()),
      createMockInbox("4", new Date(Date.now() - 1000).toISOString()),
      createMockInbox("1", new Date(Date.now() - 4000).toISOString()),
    ]);

    const records = await claimEvents(randomUUID(), 4);
    expect(records).toHaveLength(4);
    expect(records[0]._id).toBe("1");
    expect(records[1]._id).toBe("2");
    expect(records[2]._id).toBe("3");
    expect(records[3]._id).toBe("4");
  });
});
