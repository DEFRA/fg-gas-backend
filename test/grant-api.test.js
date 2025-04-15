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
import { grant1, grant2, grant3 } from "./fixtures/grants.js";
import Joi from "joi";

let grants;
let applications;
let client;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  grants = client.db().collection("grants");
  applications = client.db().collection("applications");
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

  it("returns 409 when code exists", async () => {
    await Wreck.post(`${env.API_URL}/grants`, {
      json: true,
      payload: grant1,
    });

    let response;
    try {
      await Wreck.post(`${env.API_URL}/grants`, {
        json: true,
        payload: grant1,
      });
    } catch (err) {
      response = err.data.payload;
    }

    expect(response).toEqual({
      statusCode: 409,
      error: "Conflict",
      message: `Grant with code "${grant1.code}" already exists`,
    });
  });
});

describe("GET /grants", () => {
  beforeEach(async () => {
    await grants.deleteMany({});
  });

  it("finds grants", async () => {
    await grants.insertMany([{ ...grant1 }, { ...grant2 }, { ...grant3 }]);

    const response = await Wreck.get(`${env.API_URL}/grants`, {
      json: true,
    });

    expect(response.res.statusCode).toEqual(200);
    expect(response.payload).toEqual([grant1, grant2, grant3]);
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

describe("POST /grants/{code}/applications", () => {
  beforeEach(async () => {
    await grants.deleteMany({});
    await applications.deleteMany({});
  });

  it("adds an application", async () => {
    await Wreck.post(`${env.API_URL}/grants`, {
      json: true,
      payload: {
        code: "test-code-1",
        metadata: {
          description: "test description 1",
          startDate: "2100-01-01T00:00:00.000Z",
        },
        actions: [],
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          properties: {
            question1: {
              type: "string",
              description: "This is a test question",
            },
          },
        },
      },
    });

    const submittedAt = new Date();

    const response = await Wreck.post(
      `${env.API_URL}/grants/test-code-1/applications`,
      {
        json: true,
        payload: {
          metadata: {
            clientRef: "12345",
            submittedAt,
            sbi: "1234567890",
            frn: "1234567890",
            crn: "1234567890",
            defraId: "1234567890",
          },
          answers: {
            question1: "test answer",
          },
        },
      },
    );

    expect(response.res.statusCode).toEqual(201);
    expect(response.payload).toEqual({
      clientRef: "12345",
    });

    const documents = await applications
      .find({}, { projection: { _id: 0 } })
      .toArray();

    expect(documents).toEqual([
      {
        grantCode: "test-code-1",
        clientRef: "12345",
        submittedAt,
        createdAt: expect.any(Date),
        identifiers: {
          sbi: "1234567890",
          frn: "1234567890",
          crn: "1234567890",
          defraId: "1234567890",
        },
        answers: {
          question1: "test answer",
        },
      },
    ]);
  });

  it("returns 400 when schema validation fails", async () => {
    await Wreck.post(`${env.API_URL}/grants`, {
      json: true,
      payload: {
        code: "test-code-1",
        metadata: {
          description: "test description 1",
          startDate: "2100-01-01T00:00:00.000Z",
        },
        actions: [],
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          properties: {
            question1: {
              type: "string",
              description: "This is a test question",
            },
          },
        },
      },
    });

    let response;
    try {
      await Wreck.post(`${env.API_URL}/grants/test-code-1/applications`, {
        json: true,
        payload: {
          metadata: {
            clientRef: "12345",
            submittedAt: new Date(),
            sbi: "1234567890",
            frn: "1234567890",
            crn: "1234567890",
            defraId: "1234567890",
          },
          answers: {
            question1: 42, // Invalid type
          },
        },
      });
    } catch (err) {
      response = err.data.payload;
    }

    expect(response).toEqual({
      statusCode: 400,
      error: "Bad Request",
      message:
        'Application with clientRef "12345" has invalid answers: data/question1 must be string',
    });
  });

  it("returns 409 when clientRef exists", async () => {
    await Wreck.post(`${env.API_URL}/grants`, {
      json: true,
      payload: {
        code: "test-code-1",
        metadata: {
          description: "test description 1",
          startDate: "2100-01-01T00:00:00.000Z",
        },
        actions: [],
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          properties: {
            question1: {
              type: "string",
              description: "This is a test question",
            },
          },
        },
      },
    });

    await Wreck.post(`${env.API_URL}/grants/test-code-1/applications`, {
      json: true,
      payload: {
        metadata: {
          clientRef: "12345",
          submittedAt: new Date(),
          sbi: "1234567890",
          frn: "1234567890",
          crn: "1234567890",
          defraId: "1234567890",
        },
        answers: {
          question1: "test answer",
        },
      },
    });

    let response;
    try {
      await Wreck.post(`${env.API_URL}/grants/test-code-1/applications`, {
        json: true,
        payload: {
          metadata: {
            clientRef: "12345", // Duplicate clientRef
            submittedAt: new Date(),
            sbi: "1234567890",
            frn: "1234567890",
            crn: "1234567890",
            defraId: "1234567890",
          },
          answers: {
            question1: "test answer 2",
          },
        },
      });
    } catch (err) {
      response = err.data.payload;
    }

    expect(response).toEqual({
      statusCode: 409,
      error: "Conflict",
      message: 'Application with clientRef "12345" already exists',
    });
  });
});
