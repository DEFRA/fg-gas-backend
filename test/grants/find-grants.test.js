import { MongoClient } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { grant1, grant2, grant3 } from "../fixtures/grants.js";
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

describe("GET /grants", () => {
  it("finds grants", async () => {
    await grants.insertMany([{ ...grant1 }, { ...grant2 }, { ...grant3 }]);

    const response = await wreck.get("/grants", {
      json: true,
    });

    expect(response.res.statusCode).toEqual(200);
    // Stored without an entitlementTemplates key, as every grant written before
    // this block existed is; the repository normalises it to [] on read.
    expect(response.payload).toEqual(
      [grant1, grant2, grant3].map((grant) => ({
        ...grant,
        entitlementTemplates: [],
      })),
    );
  });
});
