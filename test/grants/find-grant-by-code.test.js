import { MongoClient } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { grant1, grant2 } from "../fixtures/grants.js";
import { wreck } from "../helpers/wreck.js";

let grants;
let client;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  grants = client.db().collection("grants");
});

afterAll(async () => {
  await client?.close();
});

describe("GET /grants/{code}", () => {
  beforeEach(async () => {
    await grants.deleteMany({});
  });

  it("finds a grant by code", async () => {
    await grants.insertMany([{ ...grant1 }, { ...grant2 }]);

    const response = await wreck.get("/grants/test-code-2", {
      json: true,
    });

    expect(response.res.statusCode).toEqual(200);
    expect(response.payload).toEqual(grant2);
  });
});
