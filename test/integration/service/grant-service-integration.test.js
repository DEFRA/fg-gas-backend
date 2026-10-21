import { MongoClient } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedConfigVersion } from "../../helpers/applications.js";
import { insertGrant } from "../../helpers/grants.js";
import { wreck } from "../../helpers/wreck.js";

let client;
let db;
let grants, applications;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  db = client.db();
  grants = db.collection("grants");
  applications = db.collection("applications");
});

afterAll(async () => {
  await client?.close();
});

describe("Grant Service Integration Tests", () => {
  describe("Grant Data Integrity and Relationships", () => {
    it("should maintain referential integrity between grants and applications", async () => {
      const testId = Date.now();
      const grantCode = `test-grant-rel-${testId}`;

      // Create grant
      const grantData = {
        code: grantCode,
        version: "0.0.0",
        metadata: {
          description: "Grant for testing referential integrity",
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
                farmName: { type: "string", minLength: 1 },
                totalAcres: { type: "number", minimum: 1 },
              },
              required: ["farmName", "totalAcres"],
            },
            stages: [
              { code: "STAGE_1", statuses: [{ code: "NEW", validFrom: [] }] },
            ],
          },
        ],
        actions: [],
      };

      await insertGrant(grantData);

      await seedConfigVersion(db, grantCode);

      // Submit application for the grant
      const applicationData = {
        metadata: {
          clientRef: `grant-service-${testId}`,
          submittedAt: new Date().toISOString(),
          sbi: "123456789",
          frn: "987654321",
          crn: "555666777",
          defraId: "DEF123456",
          configVersion: "1.0.0",
        },
        answers: {
          farmName: "Test Integration Farm",
          totalAcres: 150.5,
        },
      };

      const appResponse = await wreck.post(
        `/grants/${grantCode}/applications`,
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
      expect(dbApplication.phases[0].answers.farmName).toBe(
        "Test Integration Farm",
      );
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
            version: "0.0.0",
            metadata: {
              description: `Concurrent test grant ${i}`,
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
                    testField: { type: "string" },
                  },
                },
                stages: [
                  {
                    code: "STAGE_1",
                    statuses: [{ code: "NEW", validFrom: [] }],
                  },
                ],
              },
            ],
            actions: [],
          };
          return insertGrant(grantData);
        },
      );

      await Promise.all(grantPromises);

      // Seed config versions for all grants
      await Promise.all(
        Array.from({ length: numConcurrentOperations }, (_, i) =>
          seedConfigVersion(db, `test-grant-concurrent-${testId}-${i}`),
        ),
      );

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
              configVersion: "1.0.0",
            },
            answers: {
              testField: `Test value ${i}`,
            },
          };
          return wreck.post(
            `/grants/test-grant-concurrent-${testId}-${i}/applications`,
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
          version: "0.0.0",
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
        version: "0.0.0",
        metadata: {
          description: "Grant with complex business validation rules",
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
            stages: [
              { code: "STAGE_1", statuses: [{ code: "NEW", validFrom: [] }] },
            ],
          },
        ],
        actions: [
          {
            name: "eligibility-check",
            method: "POST",
            url: "http://eligibility-service.test/check",
          },
        ],
      };

      await insertGrant(businessGrantData);

      await seedConfigVersion(db, grantCode);

      // Submit valid application
      const validApplicationData = {
        metadata: {
          clientRef: `grant-service-business-${testId}`,
          submittedAt: new Date().toISOString(),
          sbi: "123456789",
          frn: "987654321",
          crn: "555666777",
          defraId: "DEF123456",
          configVersion: "1.0.0",
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

      const validResponse = await wreck.post(
        `/grants/${grantCode}/applications`,
        { payload: validApplicationData },
      );
      expect(validResponse.res.statusCode).toBe(204);

      // Verify application data integrity
      const dbApplication = await applications.findOne({
        clientRef: `grant-service-business-${testId}`,
      });
      expect(dbApplication.phases[0].answers.farmType).toBe("mixed");
      expect(dbApplication.phases[0].answers.totalLandSize).toBe(250.75);
      expect(dbApplication.phases[0].answers.livestockNumbers.cattle).toBe(50);
      expect(
        dbApplication.phases[0].answers.environmentalCertification,
      ).toContain("organic");

      // Test invalid application (violates business rules)
      const invalidApplicationData = {
        metadata: {
          clientRef: `grant-service-invalid-${testId}`,
          submittedAt: new Date().toISOString(),
          sbi: "123456789",
          frn: "987654321",
          crn: "555666777",
          defraId: "DEF123456",
          configVersion: "1.0.0",
        },
        answers: {
          farmType: "invalid-type", // Invalid enum value
          totalLandSize: -5, // Below minimum
          previousGrantReceived: false,
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

      expect(validationError.statusCode).toBe(400);
      expect(validationError.message).toContain("has invalid answers");
    });
  });
});
