import { MongoClient } from "mongodb";
import { randomUUID } from "node:crypto";
import { env } from "node:process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { grant3 } from "../fixtures/grants.js";
import { wreck } from "../helpers/wreck.js";

let applications;
let client;
let outbox;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  applications = client.db().collection("applications");
  outbox = client.db().collection("outbox");
});

afterAll(async () => {
  await client?.close();
});

describe("POST /grants/{code}/applications", () => {
  it("stores submitted application", async () => {
    await wreck.post("/grants", {
      json: true,
      payload: {
        code: "test-code-1",
        metadata: {
          description: "test description 1",
          startDate: "2100-01-01T00:00:00.000Z",
        },
        actions: [],
        phases: [
          {
            code: "PHASE_1",
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
            stages: [{ code: "STAGE_1", statuses: [{ code: "NEW" }] }],
          },
        ],
      },
    });

    const submittedAt = new Date();

    const clientRef = `cr-12345-${randomUUID()}`;

    const response = await wreck.post("/grants/test-code-1/applications", {
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
    });

    expect(response.res.statusCode).toEqual(204);
    expect(response.res.statusMessage).toEqual("No Content");

    const documents = await applications
      .find({}, { projection: { _id: 0 } })
      .toArray();

    expect(documents).toEqual([
      {
        currentPhase: "PHASE_1",
        currentStage: "STAGE_1",
        currentStatus: "NEW",
        clientRef,
        submittedAt,
        code: "test-code-1",
        agreements: {},
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
        identifiers: {
          sbi: "1234567890",
          frn: "1234567890",
          crn: "1234567890",
          defraId: "1234567890",
        },
        phases: [
          {
            code: "PHASE_1",
            answers: {
              question1: "test answer",
            },
          },
        ],
      },
    ]);

    await expect(outbox).toHaveRecord({
      target: env.GAS__SNS__GRANT_APPLICATION_CREATED_TOPIC_ARN,
    });

    await expect(outbox).toHaveRecord({
      target: env.GAS__SNS__CREATE_NEW_CASE_TOPIC_ARN,
    });

    expect(env.GAS__SQS__GRANT_APPLICATION_CREATED_QUEUE_URL).toHaveReceived({
      id: expect.any(String),
      time: expect.any(String),
      source: "fg-gas-backend",
      specversion: "1.0",
      type: `cloud.defra.local.fg-gas-backend.application.created`,
      datacontenttype: "application/json",
      traceparent: "xxxx-xxxx-xxxx-xxxx",
      data: {
        clientRef,
        code: "test-code-1",
        status: "PHASE_1:STAGE_1:NEW",
      },
    });

    expect(env.CW__SQS__CREATE_NEW_CASE_QUEUE_URL).toHaveReceived({
      id: expect.any(String),
      time: expect.any(String),
      source: "fg-gas-backend",
      specversion: "1.0",
      type: `cloud.defra.local.fg-gas-backend.case.create`,
      datacontenttype: "application/json",
      traceparent: "xxxx-xxxx-xxxx-xxxx",
      data: {
        caseRef: clientRef,
        workflowCode: "test-code-1",
        payload: {
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
    });
  });

  it("returns 400 when schema validation fails", async () => {
    await wreck.post("/grants", {
      json: true,
      payload: {
        code: "test-code-1",
        metadata: {
          description: "test description 1",
          startDate: "2100-01-01T00:00:00.000Z",
        },
        actions: [],

        phases: [
          {
            code: "PHASE_1",
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
            stages: [{ code: "STAGE_1", statuses: [{ code: "NEW" }] }],
          },
        ],
      },
    });

    let response;
    try {
      await wreck.post("/grants/test-code-1/applications", {
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

    const documents = await applications
      .find({}, { projection: { _id: 0 } })
      .toArray();

    expect(documents).toEqual([]);

    expect(response).toEqual({
      statusCode: 400,
      error: "Bad Request",
      message:
        'Application with clientRef "12345" has invalid answers: question1 must be string',
    });
  });

  it("returns 409 when clientRef exists", async () => {
    await wreck.post("/grants", {
      json: true,
      payload: {
        code: "test-code-1",
        metadata: {
          description: "test description 1",
          startDate: "2100-01-01T00:00:00.000Z",
        },
        actions: [],

        phases: [
          {
            code: "PHASE_1",
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
            stages: [{ code: "STAGE_1", statuses: [{ code: "NEW" }] }],
          },
        ],
      },
    });

    await wreck.post("/grants/test-code-1/applications", {
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
      await wreck.post("/grants/test-code-1/applications", {
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

    const documents = await applications
      .find({}, { projection: { _id: 0 } })
      .toArray();

    expect(documents).toEqual([
      {
        phases: [{ code: "PHASE_1", answers: { question1: "test answer" } }],
        clientRef: "12345",
        code: "test-code-1",
        identifiers: {
          crn: "1234567890",
          defraId: "1234567890",
          frn: "1234567890",
          sbi: "1234567890",
        },
        agreements: {},
        currentPhase: "PHASE_1",
        currentStage: "STAGE_1",
        currentStatus: "NEW",
        createdAt: expect.any(String),
        submittedAt: expect.any(Date),
        updatedAt: expect.any(String),
      },
    ]);

    expect(response).toEqual({
      statusCode: 409,
      error: "Conflict",
      message: 'Application with clientRef "12345" exists',
    });
  });

  it("responds with 400 when the application send invalid unit value", async () => {
    await wreck.post("/grants", {
      json: true,
      payload: grant3,
    });

    let response;
    try {
      await wreck.post("/grants/test-code-3/applications", {
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
    await wreck.post("/grants", {
      json: true,
      payload: grant3,
    });

    let response;
    try {
      await wreck.post("/grants/test-code-3/applications", {
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
    await wreck.post("/grants", {
      json: true,
      payload: grant3,
    });

    let response;
    try {
      await wreck.post("/grants/test-code-3/applications", {
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
    await wreck.post("/grants", {
      json: true,
      payload: grant3,
    });

    let response;
    try {
      await wreck.post("/grants/test-code-3/applications", {
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
