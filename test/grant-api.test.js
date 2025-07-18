import { ReceiveMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import Wreck from "@hapi/wreck";
import Joi from "joi";
import { MongoClient } from "mongodb";
import { randomUUID } from "node:crypto";
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
import { grant1, grant2, grant3 } from "./fixtures/grants.js";

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
      payload: grant1,
    });

    expect(response.res.statusCode).toEqual(204);
    expect(response.res.statusMessage).toEqual("No Content");

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
        console.log("INCOMING REQUEST:", _req.url, _req.method);

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

    const response = await Wreck.post(
      `${env.API_URL}/grants/test-code-1/actions/calc-totals/invoke`,
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

    const response = await Wreck.post(
      `${env.API_URL}/grants/test-code-1/actions/calc-with-params/invoke?areaId=123&paramOne=a&paramTwo=b`,
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

    const clientRef = `cr-12345-${randomUUID()}`;

    const response = await Wreck.post(
      `${env.API_URL}/grants/test-code-1/applications`,
      {
        headers: {
          "x-cdp-request-id": "xxxx-xxxx-xxxx-xxxx",
        },
        payload: {
          metadata: {
            clientRef,
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

    expect(response.res.statusCode).toEqual(204);
    expect(response.res.statusMessage).toEqual("No Content");

    const documents = await applications
      .find({}, { projection: { _id: 0 } })
      .toArray();

    expect(documents).toEqual([
      {
        clientRef,
        submittedAt,
        code: "test-code-1",
        createdAt: expect.any(String),
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

    const sqsClient = new SQSClient({
      region: env.AWS_REGION,
      endpoint: env.AWS_ENDPOINT_URL,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      },
    });

    const data = await sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: env.GRANT_APPLICATION_CREATED_QUEUE,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 5,
      }),
    );

    const parsedMessages = data.Messages.map((message) =>
      JSON.parse(message.Body),
    ).filter((message) => message.data.clientRef === clientRef);

    expect(parsedMessages).toEqual([
      {
        id: expect.any(String),
        time: expect.any(String),
        source: "fg-gas-backend",
        specversion: "1.0",
        type: `cloud.defra.development.fg-gas-backend.application.created`,
        datacontenttype: "application/json",
        traceparent: "xxxx-xxxx-xxxx-xxxx",
        data: {
          clientRef,
          code: "test-code-1",
          createdAt: expect.any(String),
          submittedAt: expect.any(String),
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
        'Application with clientRef "12345" has invalid answers: question1 must be string',
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
      message: 'Application with clientRef "12345" exists',
    });
  });

  it("success add application", async () => {
    await Wreck.post(`${env.API_URL}/grants`, {
      json: true,
      payload: grant3,
    });

    const response = await Wreck.post(
      `${env.API_URL}/grants/test-code-3/applications`,
      {
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
            scheme: "SFI",
            year: 2025,
            hasCheckedLandIsUpToDate: true,
            actionApplications: [
              {
                parcelId: "9238",
                sheetId: "SX0679",
                code: "CSAM1",
                appliedFor: {
                  unit: "ha",
                  quantity: 20.23,
                },
              },
            ],
          },
        },
      },
    );

    expect(response.res.statusCode).toEqual(204);
    expect(response.res.statusMessage).toEqual("No Content");
  });

  it("responds with 400 when the application send invalid unit value", async () => {
    await Wreck.post(`${env.API_URL}/grants`, {
      json: true,
      payload: grant3,
    });

    let response;
    try {
      await Wreck.post(`${env.API_URL}/grants/test-code-3/applications`, {
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
            scheme: "SFI",
            year: 2025,
            hasCheckedLandIsUpToDate: true,
            actionApplications: [
              {
                parcelId: "123456",
                sheetId: "AB1234",
                code: "WEEDING",
                appliedFor: {
                  unit: "liters",
                  quantity: 2,
                },
              },
            ],
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
        'Application with clientRef "12345" has invalid answers: actionApplications/0/appliedFor/unit must be equal to one of the allowed values',
    });
  });

  it("responds with 400 when the application send missing code value", async () => {
    await Wreck.post(`${env.API_URL}/grants`, {
      json: true,
      payload: grant3,
    });

    let response;
    try {
      await Wreck.post(`${env.API_URL}/grants/test-code-3/applications`, {
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
            scheme: "SFI",
            year: 2025,
            hasCheckedLandIsUpToDate: true,
            actionApplications: [
              {
                parcelId: "123456",
                sheetId: "AB1234",
                appliedFor: {
                  unit: "count",
                  quantity: 1,
                },
              },
            ],
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
        "Application with clientRef \"12345\" has invalid answers: actionApplications/0 must have required property 'code'",
    });
  });

  it("responds with 400 when the application send invalid sheet value", async () => {
    await Wreck.post(`${env.API_URL}/grants`, {
      json: true,
      payload: grant3,
    });

    let response;
    try {
      await Wreck.post(`${env.API_URL}/grants/test-code-3/applications`, {
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
            scheme: "SFI",
            year: 2025,
            hasCheckedLandIsUpToDate: true,
            actionApplications: [
              {
                parcelId: "123456",
                sheetId: "A1234",
                code: "TREE_PLANTING",
                appliedFor: {
                  unit: "ha",
                  quantity: 3,
                },
              },
            ],
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
        'Application with clientRef "12345" has invalid answers: actionApplications/0/sheetId must match pattern "[A-Z]{2}[0-9]{4}"',
    });
  });

  it("responds with 400 when the application send invalid parcel Id value", async () => {
    await Wreck.post(`${env.API_URL}/grants`, {
      json: true,
      payload: grant3,
    });

    let response;
    try {
      await Wreck.post(`${env.API_URL}/grants/test-code-3/applications`, {
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
            scheme: "SFI",
            year: 2025,
            hasCheckedLandIsUpToDate: true,
            actionApplications: [
              {
                parcelId: "abc123",
                sheetId: "AB1234",
                code: "TREE_PLANTING",
                appliedFor: {
                  unit: "ha",
                  quantity: 10,
                },
              },
            ],
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
        'Application with clientRef "12345" has invalid answers: actionApplications/0/parcelId must match pattern "^\\d+$"',
    });
  });
});
