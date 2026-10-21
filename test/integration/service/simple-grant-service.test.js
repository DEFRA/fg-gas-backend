import { MongoClient } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedConfigVersion } from "../../helpers/applications.js";
import { insertGrant } from "../../helpers/grants.js";
import { wreck } from "../../helpers/wreck.js";

let client;
let db;
let applications;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  db = client.db();
  applications = db.collection("applications");
});

afterAll(async () => {
  await client?.close();
});

describe("Simple Grant Service Integration Tests", () => {
  it("should create grant and application with validation", async () => {
    const testId = Date.now();
    const grantCode = `test-grant-service-${testId}`;

    // Create grant
    const grantData = {
      code: grantCode,
      version: "0.0.0",
      metadata: {
        description: "Test grant with validation rules",
        startDate: "2025-01-01T00:00:00.000Z",
      },
      amendablePositions: [],
      phases: [
        {
          code: "PHASE_1",
          questions: {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            type: "object",
            properties: {
              farmName: { type: "string", minLength: 2 },
              farmSize: { type: "number", minimum: 1, maximum: 10000 },
              animalTypes: {
                type: "array",
                items: {
                  type: "string",
                  enum: ["cattle", "sheep", "pigs", "poultry"],
                },
                minItems: 1,
              },
              organicCertified: { type: "boolean" },
            },
            required: [
              "farmName",
              "farmSize",
              "animalTypes",
              "organicCertified",
            ],
          },
          stages: [
            { code: "STAGE_1", statuses: [{ code: "NEW", validFrom: [] }] },
          ],
        },
      ],
      actions: [
        {
          name: "calculate-subsidy",
          method: "POST",
          url: "http://external-service.test/calculate",
        },
      ],
    };

    await insertGrant(grantData);

    // Seed config version for the grant
    await seedConfigVersion(db, grantCode);

    // Submit application
    const applicationData = {
      metadata: {
        clientRef: `test-grant-service-app-${testId}`,
        submittedAt: new Date().toISOString(),
        sbi: "123456789",
        frn: "987654321",
        crn: "555666777",
        defraId: "DEF123456",
        configVersion: "1.0.0",
      },
      answers: {
        farmName: "Test Service Farm",
        farmSize: 125.5,
        animalTypes: ["cattle", "sheep"],
        organicCertified: true,
      },
    };

    const appResponse = await wreck.post(`/grants/${grantCode}/applications`, {
      headers: { "x-cdp-request-id": `grant-service-test-${testId}` },
      payload: applicationData,
    });
    expect(appResponse.res.statusCode).toBe(204);

    // Verify application in database
    const dbApplication = await applications.findOne({
      clientRef: `test-grant-service-app-${testId}`,
    });
    expect(dbApplication).toBeTruthy();
    expect(dbApplication.code).toBe(grantCode);
    expect(dbApplication.currentPhase).toBe("PHASE_1");
    expect(dbApplication.currentStage).toBe("STAGE_1");
    expect(dbApplication.currentStatus).toBe("NEW");
    expect(dbApplication.phases[0].answers.farmName).toBe("Test Service Farm");
    expect(dbApplication.phases[0].answers.animalTypes).toContain("cattle");
    expect(dbApplication.identifiers.sbi).toBe("123456789");
  });

  it("should handle validation errors gracefully", async () => {
    const testId = Date.now();
    const grantCode = `test-grant-validation-${testId}`;

    // Create grant with validation rules
    const grantData = {
      code: grantCode,
      version: "0.0.0",
      metadata: {
        description: "Test grant for validation",
        startDate: "2025-01-01T00:00:00.000Z",
      },
      amendablePositions: [],
      phases: [
        {
          code: "PHASE_1",
          questions: {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            type: "object",
            properties: {
              email: { type: "string", format: "email" },
              age: { type: "integer", minimum: 18, maximum: 100 },
            },
            required: ["email", "age"],
          },
          stages: [
            { code: "STAGE_1", statuses: [{ code: "NEW", validFrom: [] }] },
          ],
        },
      ],
      actions: [],
    };

    await insertGrant(grantData);

    // Seed config version for the grant
    await seedConfigVersion(db, grantCode);

    // Try invalid application
    const invalidApplicationData = {
      metadata: {
        clientRef: `test-validation-invalid-${testId}`,
        submittedAt: new Date().toISOString(),
        sbi: "123456789",
        frn: "987654321",
        crn: "555666777",
        defraId: "DEF123456",
        configVersion: "1.0.0",
      },
      answers: {
        email: "not-an-email", // Invalid email format
        age: 16, // Below minimum
      },
    };

    let validationError;
    try {
      await wreck.post(`/grants/${grantCode}/applications`, {
        json: true,
        payload: invalidApplicationData,
      });
    } catch (error) {
      validationError = error.data.payload;
    }

    expect(validationError).toBeTruthy();
    expect(validationError.statusCode).toBe(400);
    expect(validationError.message).toContain("has invalid answers");

    // Verify no invalid application was stored
    const dbApplication = await applications.findOne({
      clientRef: `test-validation-invalid-${testId}`,
    });
    expect(dbApplication).toBe(null);
  });
});
