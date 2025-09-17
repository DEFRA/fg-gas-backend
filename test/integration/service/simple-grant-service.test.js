import { MongoClient } from "mongodb";
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
import { wreck } from "../../helpers/wreck.js";

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

describe("Simple Grant Service Integration Tests", () => {
  beforeEach(async () => {
    await grants.deleteMany({ code: { $regex: "^test-grant-service-" } });
    await applications.deleteMany({
      clientRef: { $regex: "^test-grant-service-" },
    });
  });

  afterEach(async () => {
    await grants.deleteMany({ code: { $regex: "^test-grant-service-" } });
    await applications.deleteMany({
      clientRef: { $regex: "^test-grant-service-" },
    });
  });

  it("should create grant and application with validation", async () => {
    const testId = Date.now();
    const grantCode = `test-grant-service-${testId}`;

    // Create grant
    const grantData = {
      code: grantCode,
      metadata: {
        description: "Test grant with validation rules",
        startDate: "2025-01-01T00:00:00.000Z",
      },
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
        required: ["farmName", "farmSize", "animalTypes", "organicCertified"],
      },
      actions: [
        {
          name: "calculate-subsidy",
          method: "POST",
          url: "http://external-service.test/calculate",
        },
      ],
    };

    const grantResponse = await wreck.post("/grants", {
      payload: grantData,
    });
    expect(grantResponse.res.statusCode).toBe(204);

    // Verify grant in database
    const dbGrant = await grants.findOne({ code: grantCode });
    expect(dbGrant).toBeTruthy();
    expect(dbGrant.code).toBe(grantCode);
    expect(dbGrant.questions.properties.farmSize.minimum).toBe(1);
    expect(dbGrant.actions).toHaveLength(1);

    // Submit application
    const applicationData = {
      metadata: {
        clientRef: `test-grant-service-app-${testId}`,
        submittedAt: new Date().toISOString(),
        sbi: "123456789",
        frn: "987654321",
        crn: "555666777",
        defraId: "DEF123456",
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
    expect(dbApplication.answers.farmName).toBe("Test Service Farm");
    expect(dbApplication.answers.animalTypes).toContain("cattle");
    expect(dbApplication.identifiers.sbi).toBe("123456789");
  });

  it("should handle validation errors gracefully", async () => {
    const testId = Date.now();
    const grantCode = `test-grant-validation-${testId}`;

    // Create grant with validation rules
    const grantData = {
      code: grantCode,
      metadata: {
        description: "Test grant for validation",
        startDate: "2025-01-01T00:00:00.000Z",
      },
      questions: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: {
          email: { type: "string", format: "email" },
          age: { type: "integer", minimum: 18, maximum: 100 },
        },
        required: ["email", "age"],
      },
      actions: [],
    };

    await wreck.post("/grants", {
      payload: grantData,
    });

    // Try invalid application
    const invalidApplicationData = {
      metadata: {
        clientRef: `test-validation-invalid-${testId}`,
        submittedAt: new Date().toISOString(),
        sbi: "123456789",
        frn: "987654321",
        crn: "555666777",
        defraId: "DEF123456",
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

  it("should prevent duplicate grant creation", async () => {
    const testId = Date.now();
    const grantCode = `test-grant-duplicate-${testId}`;

    const grantData = {
      code: grantCode,
      metadata: {
        description: "Test duplicate prevention",
        startDate: "2025-01-01T00:00:00.000Z",
      },
      questions: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: {
          testField: { type: "string" },
        },
        required: ["testField"],
      },
      actions: [],
    };

    // Create first grant
    const firstResponse = await wreck.post("/grants", {
      payload: grantData,
    });
    expect(firstResponse.res.statusCode).toBe(204);

    // Try to create duplicate
    let duplicateError;
    try {
      await wreck.post("/grants", {
        json: true,
        payload: grantData,
      });
    } catch (error) {
      duplicateError = error.data.payload;
    }

    expect(duplicateError.statusCode).toBe(409);
    expect(duplicateError.message).toContain(
      `Grant with code "${grantCode}" already exists`,
    );

    // Verify only one grant exists
    const grantCount = await grants.countDocuments({ code: grantCode });
    expect(grantCount).toBe(1);
  });
});
