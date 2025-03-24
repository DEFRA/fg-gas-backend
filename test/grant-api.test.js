import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import http from "node:http";
import Wreck from "@hapi/wreck";
import { MongoClient } from "mongodb";
import { assert } from "../src/common/assert.js";
import { grant1, grant2 } from "./fixtures/grants.js";

describe("Grant API", () => {
  let grants;
  let client;

  before(async () => {
    client = await MongoClient.connect(global.MONGO_URI);
    grants = client.db().collection("grants");
  });

  after(async () => {
    await client.close();
  });

  describe("POST /grants", () => {
    beforeEach(async () => {
      await grants.deleteMany({});
    });

    it("adds a grant", async () => {
      const response = await Wreck.post(`${global.API_URL}/grants`, {
        json: true,
        payload: grant1,
      });

      assert.equal(response.res.statusCode, 201);
      assert.deepEqual(response.payload, {
        code: "test-code-1",
      });

      const documents = await grants
        .find({}, { projection: { _id: 0 } })
        .toArray();

      assert.deepEqual(documents, [grant1]);
    });
  });

  describe("GET /grants", () => {
    beforeEach(async () => {
      await grants.deleteMany({});
    });

    it("finds grants", async () => {
      await grants.insertMany([{ ...grant1 }, { ...grant2 }]);

      const response = await Wreck.get(`${global.API_URL}/grants`, {
        json: true,
      });

      assert.equal(response.res.statusCode, 200);
      assert.deepEqual(response.payload, [grant1, grant2]);
    });
  });

  describe("GET /grants/{code}", () => {
    beforeEach(async () => {
      await grants.deleteMany({});
    });

    it("finds a grant by code", async () => {
      await grants.insertMany([{ ...grant1 }, { ...grant2 }]);

      const response = await Wreck.get(`${global.API_URL}/grants/test-code-2`, {
        json: true,
      });

      assert.equal(response.res.statusCode, 200);
      assert.deepEqual(response.payload, grant2);
    });
  });

  describe("POST /grants/{code}/actions/{name}/invoke", () => {
    let server;

    beforeEach(async () => {
      await grants.deleteMany({});

      server = http
        .createServer((_req, res) => {
          res.writeHead(200, {
            "Content-Type": "application/json",
          });
          res.end(
            JSON.stringify({
              message: "Action invoked",
            }),
          );
        })
        .listen(3002);
    });

    afterEach(() => {
      server.close();
    });

    it("invokes an action and returns the response", async () => {
      await grants.insertMany([
        {
          ...grant1,
          actions: [
            {
              name: "calc-totals",
              method: "POST",
              url: "http://host.docker.internal:3002",
            },
          ],
        },
      ]);

      const response = await Wreck.post(
        `${global.API_URL}/grants/test-code-1/actions/calc-totals/invoke`,
        {
          json: true,
          payload: {},
        },
      );

      assert.equal(response.res.statusCode, 200);
      assert.deepEqual(response.payload, {
        message: "Action invoked",
      });
    });
  });
});
