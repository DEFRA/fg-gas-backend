import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { env } from "node:process";
import Wreck from "@hapi/wreck";
import { MongoClient } from "mongodb";
import { grant3 } from "../fixtures/grants.js";

let applications;
let client;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  applications = client.db().collection("applications");
});

afterAll(async () => {
  await client?.close();
});

describe("POST /grants/{code}/applications", () => {
  beforeEach(async () => {
    await applications.deleteMany({});
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

    expect(response.res.statusCode).toEqual(201);
    expect(response.payload).toEqual({
      clientRef: "12345",
    });
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
        'Application with clientRef "12345" has invalid answers: data/actionApplications/0/appliedFor/unit must be equal to one of the allowed values',
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
        "Application with clientRef \"12345\" has invalid answers: data/actionApplications/0 must have required property 'code'",
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
        'Application with clientRef "12345" has invalid answers: data/actionApplications/0/sheetId must match pattern "[A-Z]{2}[0-9]{4}"',
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
        'Application with clientRef "12345" has invalid answers: data/actionApplications/0/parcelId must match pattern "^\\d+$"',
    });
  });
});
