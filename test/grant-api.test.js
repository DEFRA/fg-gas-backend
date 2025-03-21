import { describe, it, before, after, beforeEach } from "node:test";
import { assert } from "../src/common/assert.js";
import Wreck from "@hapi/wreck";
import { MongoClient } from "mongodb";
import { config } from "../src/common/config.js";
import { grant1, grant2 } from "./fixtures/grants.js";
import { collection as grantsCollection } from "../src/grants/grant-repository.js";

describe("Grant API Tests", () => {
  let db;
  let client;

  before(async () => {
    client = new MongoClient(global.MONGO_URI);
    await client.connect();
    db = client.db(config.get("mongoDatabase"));
  });

  after(async () => {
    if (client) await client.close();
  });

  describe("POST /grants", () => {
    beforeEach(async () => {
      await db.collection(grantsCollection).deleteMany({});
    });

    it("add a grant", async () => {
      const postResponse = await Wreck.post(`${global.APP_URL}/grants`, {
        json: true,
        payload: grant1,
      });
      assert.equal(postResponse.res.statusCode, 201);
      assert.deepEqual(postResponse.payload, { code: "e2e-code1" });

      const results = await db.collection(grantsCollection).find().toArray();
      assert.equal(results.length, 1);
      assert.equal(results[0].code, grant1.code);
      assert.equal(results[0].metadata.name, grant1.metadata.name);
      assert.deepEqual(results[0].actions, grant1.actions);
    });
  });

  describe("GET /grants", () => {
    beforeEach(async () => {
      await db.collection(grantsCollection).deleteMany({});
    });

    it("Find grants", async () => {
      await db.collection(grantsCollection).insertMany([grant1, grant2]);

      const getResponse = await Wreck.get(`${global.APP_URL}/grants`, {
        json: true,
      });
      assert.equal(getResponse.res.statusCode, 200);
      assert.equal(getResponse.payload.length, 2);
      assert.equal(getResponse.payload[0].code, "e2e-code1");
      assert.equal(getResponse.payload[1].code, "e2e-code2");
    });
  });

  describe("GET /grants/{code}", () => {
    beforeEach(async () => {
      await db.collection(grantsCollection).deleteMany({});
    });

    it("Find grant by code", async () => {
      await db.collection(grantsCollection).insertMany([grant1, grant2]);

      const getResponse = await Wreck.get(
        `${global.APP_URL}/grants/e2e-code2`,
        {
          json: true,
        },
      );
      assert.equal(getResponse.res.statusCode, 200);
      assert.equal(getResponse.payload.code, "e2e-code2");
    });
  });
});
