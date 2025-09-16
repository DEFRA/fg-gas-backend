import { MongoClient } from "mongodb";
import http from "node:http";
import { env } from "node:process";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { grant1 } from "../fixtures/grants.js";
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

describe("POST /grants/{code}/actions/{name}/invoke", () => {
  let server;

  beforeEach(async () => {
    await grants.deleteMany({});

    server = http
      .createServer((_req, res) => {
        if (
          _req.url === "/calculations/my-super-calc?code=test-code-1" &&
          _req.method.toUpperCase() === "POST"
        ) {
          res.writeHead(200, {
            "Content-Type": "application/json",
          });
          res.end(
            JSON.stringify({
              message: "Action invoked: my-super-calc",
            }),
          );
        }
        if (
          _req.url ===
            "/calculations/my-area-calc/area/123?code=test-code-1&paramOne=a&paramTwo=b" &&
          _req.method.toUpperCase() === "POST"
        ) {
          res.writeHead(200, {
            "Content-Type": "application/json",
          });
          res.end(
            JSON.stringify({
              message: "Action invoked: my-area-calc",
            }),
          );
        }
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
            url: "http://host.docker.internal:3002/calculations/my-super-calc",
          },
          {
            name: "calc-with-params",
            method: "POST",
            url: "http://host.docker.internal:3002/calculations/my-area-calc/area/{areaId}",
          },
        ],
      },
    ]);

    const response = await wreck.post(
      "/grants/test-code-1/actions/calc-totals/invoke",
      {
        json: true,
        payload: {},
      },
    );

    expect(response.res.statusCode).toEqual(200);
    expect(response.payload).toEqual({
      message: "Action invoked: my-super-calc",
    });
  });

  it("invokes an action with parameters and returns the response", async () => {
    await grants.insertMany([
      {
        ...grant1,
        actions: [
          {
            name: "calc-with-params",
            method: "POST",
            url: "http://host.docker.internal:3002/calculations/my-area-calc/area/$areaId",
          },
        ],
      },
    ]);

    const response = await wreck.post(
      "/grants/test-code-1/actions/calc-with-params/invoke?areaId=123&paramOne=a&paramTwo=b",
      {
        json: true,
        payload: {},
      },
    );

    expect(response.res.statusCode).toEqual(200);
    expect(response.payload).toEqual({
      message: "Action invoked: my-area-calc",
    });
  });
});
