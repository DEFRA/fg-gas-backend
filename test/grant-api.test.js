import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import { env } from "node:process";
import http from "node:http";
import Wreck from "@hapi/wreck";
import { MongoClient } from "mongodb";
import { grant1, grant2 } from "./fixtures/grants.js";
import Joi from "joi";

let grants;
let client;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  grants = client.db().collection("grants");
});

afterAll(async () => {
  await client?.close();
});

describe("POST /grants", () => {
  beforeEach(async () => {
    await grants.deleteMany({});
  });

  it("adds a grant", async () => {
    const response = await Wreck.post(`${env.API_URL}/grants`, {
      json: true,
      payload: grant1,
    });

    expect(response.res.statusCode).toEqual(201);
    expect(response.payload).toEqual({
      code: "test-code-1",
    });

    const documents = await grants
      .find({}, { projection: { _id: 0 } })
      .toArray();

    expect(documents).toEqual([
      {
        ...grant1,
        metadata: {
          ...grant1.metadata,
          startDate: Joi.date().validate(grant1.metadata.startDate).value,
        },
      },
    ]);
  });
});

describe("GET /grants", () => {
  beforeEach(async () => {
    await grants.deleteMany({});
  });

  it("finds grants", async () => {
    await grants.insertMany([{ ...grant1 }, { ...grant2 }]);

    const response = await Wreck.get(`${env.API_URL}/grants`, {
      json: true,
    });

    expect(response.res.statusCode).toEqual(200);
    expect(response.payload).toEqual([grant1, grant2]);
  });
});

describe("GET /grants/{code}", () => {
  beforeEach(async () => {
    await grants.deleteMany({});
  });

  it("finds a grant by code", async () => {
    await grants.insertMany([{ ...grant1 }, { ...grant2 }]);

    const response = await Wreck.get(`${env.API_URL}/grants/test-code-2`, {
      json: true,
    });

    expect(response.res.statusCode).toEqual(200);
    expect(response.payload).toEqual(grant2);
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
      `${env.API_URL}/grants/test-code-1/actions/calc-totals/invoke`,
      {
        json: true,
        payload: {},
      },
    );

    expect(response.res.statusCode).toEqual(200);
    expect(response.payload).toEqual({
      message: "Action invoked",
    });
  });
});
