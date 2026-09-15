import { MongoClient } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const OUTBOX_INDEX = "publicationDate_-1__id_-1";

let client;
let db;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  db = client.db();
});

afterAll(async () => {
  await client?.close();
});

describe("event list indexes", () => {
  it("keys the outbox list newest-first with the _id tie-breaker after the service boots", async () => {
    const outboxIndex = (await db.collection("outbox").indexes()).find(
      (i) => i.name === OUTBOX_INDEX,
    );

    expect(outboxIndex.key).toEqual({ publicationDate: -1, _id: -1 });
  });

  it("exports up and nothing else", async () => {
    const migration =
      await import("../../migrations/20260901120000-add-event-list-indexes.js");

    expect(Object.keys(migration)).toEqual(["up"]);
  });
});
