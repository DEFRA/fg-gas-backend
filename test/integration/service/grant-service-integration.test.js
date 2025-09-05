import Wreck from "@hapi/wreck";
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

describe("Grant Service Integration Tests", () => {
  beforeEach(async () => {
    // Clean up test data
    await grants.deleteMany({ code: { $regex: "^test-grant-" } });
    await applications.deleteMany({ clientRef: { $regex: "^grant-service-" } });
  });

  afterEach(async () => {
    // Clean up after each test
    await grants.deleteMany({ code: { $regex: "^test-grant-" } });
    await applications.deleteMany({ clientRef: { $regex: "^grant-service-" } });
  });

  describe("Grant Creation and Validation", () => {
    it("should create grant with complex schema validation", async () => {
      const testId = Date.now();
      const grantData = {
        code: `test-grant-${testId}`,
        metadata: {
          description:
            "Complex integration test grant with multiple validation rules",
          startDate: "2025-01-01T00:00:00.000Z",
        },
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          properties: {
            farmSize: {
              type: "number",
              minimum: 1,
              maximum: 10000,
              description: "Farm size in hectares",
            },
            animalTypes: {
              type: "array",
              items: {
                type: "string",
                enum: ["cattle", "sheep", "pigs", "poultry"],
              },
              minItems: 1,
              description: "Types of animals on farm",
            },
            sustainablePractices: {
              type: "boolean",
              description: "Uses sustainable farming practices",
            },
            contactEmail: {
              type: "string",
              format: "email",
              description: "Contact email address",
            },
          },
          required: [
            "farmSize",
            "animalTypes",
            "sustainablePractices",
            "contactEmail",
          ],
        },
        actions: [
          {
            name: "calculate-subsidy",
            method: "POST",
            url: "http://external-service.test/calculate-subsidy",
          },
          {
            name: "validate-eligibility",
            method: "GET",
            url: "http://external-service.test/validate",
          },
        ],
      };

      // Test grant creation via API
      const response = await Wreck.post(`${env.API_URL}/grants`, {
        payload: grantData,
      });

      expect(response.res.statusCode).toBe(204);

      // Verify database persistence
      const dbGrant = await grants.findOne({ code: `test-grant-${testId}` });
      expect(dbGrant).toBeTruthy();
      expect(dbGrant.code).toBe(`test-grant-${testId}`);
      expect(dbGrant.questions.properties.farmSize.minimum).toBe(1);
      expect(dbGrant.questions.properties.animalTypes.items.enum).toContain(
        "cattle",
      );
      expect(dbGrant.actions).toHaveLength(2);
      expect(dbGrant.actions[0].name).toBe("calculate-subsidy");

      // Verify grant can be retrieved via API
      const getResponse = await Wreck.get(
        `${env.API_URL}/grants/${grantData.code}`,
        {
          json: true,
        },
      );
      expect(getResponse.res.statusCode).toBe(200);
      expect(getResponse.payload.code).toBe(`test-grant-${testId}`);
    });

    it("should handle grant creation with nested schema validation", async () => {
      const testId = Date.now();
      const complexGrantData = {
        code: `test-grant-complex-${testId}`,
        metadata: {
          description: "Grant with deeply nested validation rules",
          startDate: "2025-06-01T00:00:00.000Z",
        },
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          properties: {
            landParcels: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  parcelId: { type: "string", pattern: "^\\d+$" },
                  size: { type: "number", minimum: 0.1 },
                  cropTypes: {
                    type: "array",
                    items: { type: "string" },
                    minItems: 1,
                  },
                  soilType: {
                    type: "string",
                    enum: ["clay", "sand", "loam", "chalk"],
                  },
                },
                required: ["parcelId", "size", "cropTypes", "soilType"],
              },
              minItems: 1,
            },
          },
          required: ["landParcels"],
        },
        actions: [],
      };

      // Create complex grant
      const response = await Wreck.post(`${env.API_URL}/grants`, {
        payload: complexGrantData,
      });
      expect(response.res.statusCode).toBe(204);

      // Verify nested schema structure persisted correctly
      const dbGrant = await grants.findOne({
        code: `test-grant-complex-${testId}`,
      });
      expect(
        dbGrant.questions.properties.landParcels.items.properties.parcelId
          .pattern,
      ).toBe("^\\d+$");
      expect(
        dbGrant.questions.properties.landParcels.items.properties.soilType.enum,
      ).toContain("loam");
    });

    it("should prevent duplicate grant creation", async () => {
      const testId = Date.now();
      const grantCode = `test-grant-dup-${testId}`;
      const grantData = {
        code: grantCode,
        metadata: {
          description: "Duplicate test grant",
          startDate: "2025-01-01T00:00:00.000Z",
        },
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          properties: {
            testField: { type: "string" },
          },
        },
        actions: [],
      };

      // Create first grant
      const firstResponse = await Wreck.post(`${env.API_URL}/grants`, {
        payload: grantData,
      });
      expect(firstResponse.res.statusCode).toBe(204);

      // Attempt to create duplicate
      let duplicateError;
      try {
        await Wreck.post(`${env.API_URL}/grants`, {
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

      // Verify only one grant exists in database
      const grantCount = await grants.countDocuments({ code: grantCode });
      expect(grantCount).toBe(1);
    });
  });

  describe("Grant Data Integrity and Relationships", () => {
    it("should maintain referential integrity between grants and applications", async () => {
      const testId = Date.now();
      const grantCode = `test-grant-rel-${testId}`;

      // Create grant
      const grantData = {
        code: grantCode,
        metadata: {
          description: "Grant for testing referential integrity",
          startDate: "2025-01-01T00:00:00.000Z",
        },
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          properties: {
            farmName: { type: "string", minLength: 1 },
            totalAcres: { type: "number", minimum: 1 },
          },
          required: ["farmName", "totalAcres"],
        },
        actions: [],
      };

      await Wreck.post(`${env.API_URL}/grants`, {
        payload: grantData,
      });

      // Submit application for the grant
      const applicationData = {
        metadata: {
          clientRef: `grant-service-${testId}`,
          submittedAt: new Date().toISOString(),
          sbi: "123456789",
          frn: "987654321",
          crn: "555666777",
          defraId: "DEF123456",
        },
        answers: {
          farmName: "Test Integration Farm",
          totalAcres: 150.5,
        },
      };

      const appResponse = await Wreck.post(
        `${env.API_URL}/grants/${grantCode}/applications`,
        {
          payload: applicationData,
        },
      );
      expect(appResponse.res.statusCode).toBe(204);

      // Verify application references correct grant
      const dbApplication = await applications.findOne({
        clientRef: `grant-service-${testId}`,
      });
      expect(dbApplication.code).toBe(grantCode);
      expect(dbApplication.answers.farmName).toBe("Test Integration Farm");
      expect(dbApplication.identifiers.sbi).toBe("123456789");

      // Verify grant and application relationship
      const dbGrant = await grants.findOne({ code: grantCode });
      expect(dbGrant.code).toBe(grantCode);

      // Verify data consistency
      expect(dbApplication.code).toBe(dbGrant.code);
    });

    it("should handle concurrent grant creation and application submission", async () => {
      const testId = Date.now();
      const numConcurrentOperations = 5;

      // Create multiple grants concurrently
      const grantPromises = Array.from(
        { length: numConcurrentOperations },
        (_, i) => {
          const grantData = {
            code: `test-grant-concurrent-${testId}-${i}`,
            metadata: {
              description: `Concurrent test grant ${i}`,
              startDate: "2025-01-01T00:00:00.000Z",
            },
            questions: {
              $schema: "https://json-schema.org/draft/2020-12/schema",
              type: "object",
              properties: {
                testField: { type: "string" },
              },
            },
            actions: [],
          };
          return Wreck.post(`${env.API_URL}/grants`, { payload: grantData });
        },
      );

      const grantResponses = await Promise.all(grantPromises);
      grantResponses.forEach((response) => {
        expect(response.res.statusCode).toBe(204);
      });

      // Submit applications concurrently for each grant
      const applicationPromises = Array.from(
        { length: numConcurrentOperations },
        (_, i) => {
          const applicationData = {
            metadata: {
              clientRef: `grant-service-concurrent-${testId}-${i}`,
              submittedAt: new Date().toISOString(),
              sbi: `12345678${i}`,
              frn: `98765432${i}`,
              crn: `55566677${i}`,
              defraId: `DEF12345${i}`,
            },
            answers: {
              testField: `Test value ${i}`,
            },
          };
          return Wreck.post(
            `${env.API_URL}/grants/test-grant-concurrent-${testId}-${i}/applications`,
            { payload: applicationData },
          );
        },
      );

      const applicationResponses = await Promise.all(applicationPromises);
      applicationResponses.forEach((response) => {
        expect(response.res.statusCode).toBe(204);
      });

      // Verify all grants and applications were created
      const dbGrants = await grants
        .find({
          code: { $regex: `^test-grant-concurrent-${testId}-` },
        })
        .toArray();
      expect(dbGrants).toHaveLength(numConcurrentOperations);

      const dbApplications = await applications
        .find({
          clientRef: { $regex: `^grant-service-concurrent-${testId}-` },
        })
        .toArray();
      expect(dbApplications).toHaveLength(numConcurrentOperations);

      // Verify referential integrity maintained
      dbApplications.forEach((app, index) => {
        expect(app.code).toBe(`test-grant-concurrent-${testId}-${index}`);
        expect(app.identifiers.sbi).toBe(`12345678${index}`);
      });
    });
  });

  describe("Grant Business Logic Integration", () => {
    it("should validate complex business rules across grant and application", async () => {
      const testId = Date.now();
      const grantCode = `test-grant-business-${testId}`;

      // Create grant with complex business rules
      const businessGrantData = {
        code: grantCode,
        metadata: {
          description: "Grant with complex business validation rules",
          startDate: "2025-01-01T00:00:00.000Z",
        },
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          properties: {
            farmType: {
              type: "string",
              enum: ["dairy", "arable", "mixed", "organic"],
            },
            totalLandSize: {
              type: "number",
              minimum: 5,
              maximum: 5000,
            },
            previousGrantReceived: {
              type: "boolean",
            },
            livestockNumbers: {
              type: "object",
              properties: {
                cattle: { type: "number", minimum: 0 },
                sheep: { type: "number", minimum: 0 },
                pigs: { type: "number", minimum: 0 },
              },
            },
            environmentalCertification: {
              type: "array",
              items: {
                type: "string",
                enum: ["organic", "leaf", "rspca", "other"],
              },
            },
          },
          required: ["farmType", "totalLandSize", "previousGrantReceived"],
        },
        actions: [
          {
            name: "eligibility-check",
            method: "POST",
            url: "http://eligibility-service.test/check",
          },
        ],
      };

      await Wreck.post(`${env.API_URL}/grants`, {
        payload: businessGrantData,
      });

      // Submit valid application
      const validApplicationData = {
        metadata: {
          clientRef: `grant-service-business-${testId}`,
          submittedAt: new Date().toISOString(),
          sbi: "123456789",
          frn: "987654321",
          crn: "555666777",
          defraId: "DEF123456",
        },
        answers: {
          farmType: "mixed",
          totalLandSize: 250.75,
          previousGrantReceived: false,
          livestockNumbers: {
            cattle: 50,
            sheep: 200,
            pigs: 0,
          },
          environmentalCertification: ["organic", "rspca"],
        },
      };

      const validResponse = await Wreck.post(
        `${env.API_URL}/grants/${grantCode}/applications`,
        { payload: validApplicationData },
      );
      expect(validResponse.res.statusCode).toBe(204);

      // Verify application data integrity
      const dbApplication = await applications.findOne({
        clientRef: `grant-service-business-${testId}`,
      });
      expect(dbApplication.answers.farmType).toBe("mixed");
      expect(dbApplication.answers.totalLandSize).toBe(250.75);
      expect(dbApplication.answers.livestockNumbers.cattle).toBe(50);
      expect(dbApplication.answers.environmentalCertification).toContain(
        "organic",
      );

      // Test invalid application (violates business rules)
      const invalidApplicationData = {
        metadata: {
          clientRef: `grant-service-invalid-${testId}`,
          submittedAt: new Date().toISOString(),
          sbi: "123456789",
          frn: "987654321",
          crn: "555666777",
          defraId: "DEF123456",
        },
        answers: {
          farmType: "invalid-type", // Invalid enum value
          totalLandSize: -5, // Below minimum
          previousGrantReceived: false,
        },
      };

      let validationError;
      try {
        await Wreck.post(`${env.API_URL}/grants/${grantCode}/applications`, {
          json: true,
          payload: invalidApplicationData,
        });
      } catch (error) {
        validationError = error.data.payload;
      }

      expect(validationError.statusCode).toBe(400);
      expect(validationError.message).toContain("has invalid answers");
    });
  });
});
