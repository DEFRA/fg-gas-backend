import { describe, it, before, after, beforeEach } from "node:test";
import { assert } from "../src/common/assert.js";
import { DockerComposeEnvironment, Wait } from "testcontainers";
import Wreck from "@hapi/wreck";
import { MongoClient } from "mongodb";
import { config } from "../src/common/config.js";
import { grant1, grant2 } from "./fixtures/grants.js";
import { collection as grantsCollection } from "../src/grants/grant-repository.js";

describe("Grant API Tests", () => {
  const PORT = 3001;
  const MONGO_PORT = 28017;
  let appUrl;
  let environment;
  let mongoUri;
  let db;
  let client;

  before(async () => {
    environment = await new DockerComposeEnvironment(".", "compose.yml")
      .withEnvironment({ PORT: PORT.toString() })
      .withEnvironment({ MONGO_PORT: MONGO_PORT.toString() })
      .withWaitStrategy("mongodb", Wait.forListeningPorts())
      .withWaitStrategy("gas", Wait.forLogMessage("server started"))
      .up();

    // Get MongoDB container URI
    const container = environment.getContainer("mongodb-1");
    const mongoPort = container.getMappedPort(MONGO_PORT);
    const host = container.getHost();
    mongoUri = `mongodb://${host}:${mongoPort}`;
    appUrl = `http://${host}:${PORT}`;

    // Connect to MongoDB
    client = new MongoClient(mongoUri);
    await client.connect();
    db = client.db(config.get("mongoDatabase"));
  });

  after(async () => {
    // Shutdown and cleanup the environment
    if (client) await client.close();
    if (environment) await environment.stop();
  });

  describe("POST /grants", () => {
    beforeEach(async () => {
      await db.collection(grantsCollection).deleteMany({});
    });

    it("add a grant", async () => {
      // Make a POST request to add the grant
      const postResponse = await Wreck.post(`${appUrl}/grants`, {
        json: true,
        payload: grant1,
      });
      assert.equal(postResponse.res.statusCode, 201);
      assert.deepEqual(postResponse.payload, { code: "e2e-code1" });

      const results = await db.collection(grantsCollection).find().toArray();
      assert.equal(results.length, 1);
      assert.equal(results[0].name, grant1.name);
      assert.equal(results[0].code, grant1.code);
      assert.deepEqual(results[0].endpoints, grant1.endpoints);
    });
  });

  describe("GET /grants", () => {
    beforeEach(async () => {
      await db.collection(grantsCollection).deleteMany({});
    });

    it("Find grants", async () => {
      await db.collection(grantsCollection).insertMany([grant1, grant2]);

      const getResponse = await Wreck.get(`${appUrl}/grants`, { json: true });
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

      const getResponse = await Wreck.get(`${appUrl}/grants/e2e-code2`, {
        json: true,
      });
      assert.equal(getResponse.res.statusCode, 200);
      assert.equal(getResponse.payload.code, "e2e-code2");
    });
  });
});
