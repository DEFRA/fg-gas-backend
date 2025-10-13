import { MongoClient } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { wreck } from "../helpers/wreck.js";

let client;
let grants, applications;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  grants = client.db().collection("grants");
  applications = client.db().collection("applications");
});

afterAll(async () => {
  await client?.close();
});

describe("Simple Integration Tests", () => {
  it("should create a simple grant and application", async () => {
    const testId = Date.now();
    const grantCode = `simple-test-${testId}`;

    // Create a simple grant using the same pattern as the working tests
    const grantData = {
      code: grantCode,
      metadata: {
        description: "Simple integration test grant",
        startDate: "2025-01-01T00:00:00.000Z",
      },
      phases: [
        {
          code: "PHASE_1",
          questions: {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            type: "object",
            properties: {
              farmName: {
                type: "string",
                description: "Name of the farm",
              },
              farmSize: {
                type: "number",
                minimum: 1,
                description: "Size of the farm in hectares",
              },
            },
            required: ["farmName", "farmSize"],
          },
          stages: [{ code: "STAGE_1", statuses: [{ code: "NEW" }] }],
        },
      ],
      actions: [],
    };

    // Create the grant
    try {
      const grantResponse = await wreck.post("/grants", {
        payload: grantData,
      });
      expect(grantResponse.res.statusCode).toBe(204);
    } catch (error) {
      console.error("Grant creation failed:", error.message);
      if (error.data && error.data.payload) {
        console.error(
          "Error details:",
          JSON.stringify(error.data.payload, null, 2),
        );
      }
      throw error;
    }

    // Verify grant exists in database
    const dbGrant = await grants.findOne({ code: grantCode });
    expect(dbGrant).toBeTruthy();
    expect(dbGrant.code).toBe(grantCode);
    expect(dbGrant.phases[0].questions.properties.farmName.type).toBe("string");

    // Verify grant can be retrieved via API
    const getResponse = await wreck.get(`/grants/${grantCode}`, {
      json: true,
    });
    expect(getResponse.res.statusCode).toBe(200);
    expect(getResponse.payload.code).toBe(grantCode);

    // Submit a simple application
    const applicationData = {
      metadata: {
        clientRef: `simple-test-app-${testId}`,
        submittedAt: new Date().toISOString(),
        sbi: "123456789",
        frn: "987654321",
        crn: "555666777",
        defraId: "DEF123456",
      },
      answers: {
        farmName: "Simple Test Farm",
        farmSize: 50.5,
      },
    };

    const appResponse = await wreck.post(`/grants/${grantCode}/applications`, {
      headers: {
        "x-cdp-request-id": `simple-test-${testId}`,
      },
      payload: applicationData,
    });
    expect(appResponse.res.statusCode).toBe(204);

    // Verify application exists in database
    const dbApplication = await applications.findOne({
      clientRef: `simple-test-app-${testId}`,
    });
    expect(dbApplication).toBeTruthy();
    expect(dbApplication.code).toBe(grantCode);
    expect(dbApplication.phases[0].answers.farmName).toBe("Simple Test Farm");
    expect(dbApplication.phases[0].answers.farmSize).toBe(50.5);
    expect(dbApplication.identifiers.sbi).toBe("123456789");
  });

  it("should verify basic API endpoints are working", async () => {
    // Test the basic endpoints that we know work

    // GET /grants (should return empty initially)
    const grantsResponse = await wreck.get("/grants", {
      json: true,
    });
    expect(grantsResponse.res.statusCode).toBe(200);
    expect(Array.isArray(grantsResponse.payload)).toBe(true);
  });
});
