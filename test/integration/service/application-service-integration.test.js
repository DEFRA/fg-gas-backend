import { MongoClient } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { wreck } from "../../helpers/wreck.js";

let client;
let applications;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  applications = client.db().collection("applications");
});

afterAll(async () => {
  await client?.close();
});

describe("Application Service Integration Tests", () => {
  describe("Application Submission and Validation", () => {
    it("should process complex application with comprehensive validation", async () => {
      const testId = Date.now();
      const grantCode = `app-service-grant-${testId}`;

      // Create grant with complex schema
      const grantData = {
        code: grantCode,
        metadata: {
          description: "Complex application processing grant",
          startDate: "2025-01-01T00:00:00.000Z",
        },
        phases: [
          {
            code: "PHASE_1",
            questions: {
              $schema: "https://json-schema.org/draft/2020-12/schema",
              type: "object",
              properties: {
                applicantDetails: {
                  type: "object",
                  properties: {
                    fullName: { type: "string", minLength: 2, maxLength: 100 },
                    dateOfBirth: { type: "string", format: "date" },
                    address: {
                      type: "object",
                      properties: {
                        street: { type: "string", minLength: 5 },
                        city: { type: "string", minLength: 2 },
                        postcode: {
                          type: "string",
                          pattern: "^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$",
                        },
                      },
                      required: ["street", "city", "postcode"],
                    },
                  },
                  required: ["fullName", "dateOfBirth", "address"],
                },
                farmOperation: {
                  type: "object",
                  properties: {
                    primaryActivity: {
                      type: "string",
                      enum: [
                        "crop-production",
                        "livestock",
                        "mixed-farming",
                        "horticulture",
                      ],
                    },
                    landArea: { type: "number", minimum: 1, maximum: 10000 },
                    yearsInOperation: {
                      type: "integer",
                      minimum: 0,
                      maximum: 100,
                    },
                    certifications: {
                      type: "array",
                      items: { type: "string" },
                      minItems: 0,
                    },
                  },
                  required: ["primaryActivity", "landArea", "yearsInOperation"],
                },
                financialInfo: {
                  type: "object",
                  properties: {
                    annualTurnover: { type: "number", minimum: 0 },
                    employeeCount: { type: "integer", minimum: 0 },
                    previousGrants: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          grantCode: { type: "string" },
                          amount: { type: "number" },
                          year: {
                            type: "integer",
                            minimum: 2000,
                            maximum: 2030,
                          },
                        },
                        required: ["grantCode", "amount", "year"],
                      },
                    },
                  },
                  required: ["annualTurnover", "employeeCount"],
                },
              },
              required: ["applicantDetails", "farmOperation", "financialInfo"],
            },
            stages: [
              { code: "STAGE_1", statuses: [{ code: "NEW", validFrom: [] }] },
            ],
          },
        ],
        actions: [],
      };

      await wreck.post("/grants", {
        payload: grantData,
      });

      // Submit comprehensive application
      const applicationData = {
        metadata: {
          clientRef: `app-service-${testId}`,
          submittedAt: new Date().toISOString(),
          sbi: "123456789",
          frn: "987654321",
          crn: "555666777",
          defraId: "DEF123456",
        },
        answers: {
          applicantDetails: {
            fullName: "John Smith Test Farmer",
            dateOfBirth: "1980-05-15",
            address: {
              street: "123 Farm Lane",
              city: "Farming Village",
              postcode: "AB12 3CD",
            },
          },
          farmOperation: {
            primaryActivity: "mixed-farming",
            landArea: 250.5,
            yearsInOperation: 15,
            certifications: ["organic", "soil-association", "rspca-assured"],
          },
          financialInfo: {
            annualTurnover: 85000.5,
            employeeCount: 3,
            previousGrants: [
              {
                grantCode: "ENV-2023-001",
                amount: 15000,
                year: 2023,
              },
              {
                grantCode: "SUSTAIN-2022-045",
                amount: 8500,
                year: 2022,
              },
            ],
          },
        },
      };

      const response = await wreck.post(`/grants/${grantCode}/applications`, {
        headers: {
          "x-cdp-request-id": `test-req-${testId}`,
        },
        payload: applicationData,
      });
      expect(response.res.statusCode).toBe(204);

      // Verify application persistence with complex nested data
      const dbApplication = await applications.findOne({
        clientRef: `app-service-${testId}`,
      });
      expect(dbApplication).toBeTruthy();
      expect(dbApplication.code).toBe(grantCode);
      expect(dbApplication.phases[0].answers.applicantDetails.fullName).toBe(
        "John Smith Test Farmer",
      );
      expect(
        dbApplication.phases[0].answers.applicantDetails.address.postcode,
      ).toBe("AB12 3CD");
      expect(
        dbApplication.phases[0].answers.farmOperation.primaryActivity,
      ).toBe("mixed-farming");
      expect(
        dbApplication.phases[0].answers.farmOperation.certifications,
      ).toContain("organic");
      expect(
        dbApplication.phases[0].answers.financialInfo.previousGrants,
      ).toHaveLength(2);
      expect(
        dbApplication.phases[0].answers.financialInfo.previousGrants[0]
          .grantCode,
      ).toBe("ENV-2023-001");

      // Verify identifiers were stored correctly
      expect(dbApplication.identifiers.sbi).toBe("123456789");
      expect(dbApplication.identifiers.frn).toBe("987654321");
      expect(dbApplication.identifiers.crn).toBe("555666777");
      expect(dbApplication.metadata.defraId).toBe("DEF123456");

      // Verify timestamps
      expect(dbApplication.submittedAt).toBeDefined();
      expect(dbApplication.createdAt).toBeDefined();
    });

    it("should handle application with array validation and conditional logic", async () => {
      const testId = Date.now();
      const grantCode = `app-service-array-${testId}`;

      // Create grant with array and conditional validation
      const grantData = {
        code: grantCode,
        metadata: {
          description: "Grant testing array validation",
          startDate: "2025-01-01T00:00:00.000Z",
        },

        phases: [
          {
            code: "PHASE_1",
            questions: {
              $schema: "https://json-schema.org/draft/2020-12/schema",
              type: "object",
              properties: {
                livestockOperations: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      animalType: {
                        type: "string",
                        enum: ["cattle", "sheep", "pigs", "poultry", "goats"],
                      },
                      numberOfAnimals: { type: "integer", minimum: 1 },
                      averageWeight: { type: "number", minimum: 0.1 },
                      feedType: {
                        type: "string",
                        enum: [
                          "grass-fed",
                          "grain-fed",
                          "organic-feed",
                          "mixed",
                        ],
                      },
                      housingType: {
                        type: "string",
                        enum: ["outdoor", "barn", "free-range", "intensive"],
                      },
                    },
                    required: [
                      "animalType",
                      "numberOfAnimals",
                      "feedType",
                      "housingType",
                    ],
                  },
                  minItems: 1,
                  maxItems: 10,
                },
                totalAnimals: { type: "integer", minimum: 1 },
                organicCertified: { type: "boolean" },
              },
              required: [
                "livestockOperations",
                "totalAnimals",
                "organicCertified",
              ],
            },
            stages: [
              { code: "STAGE_1", statuses: [{ code: "NEW", validFrom: [] }] },
            ],
          },
        ],
        actions: [],
      };

      await wreck.post("/grants", {
        payload: grantData,
      });

      // Submit application with complex array data
      const applicationData = {
        metadata: {
          clientRef: `app-service-array-${testId}`,
          submittedAt: new Date().toISOString(),
          sbi: "987654321",
          frn: "123456789",
          crn: "444555666",
          defraId: "DEF789012",
        },
        answers: {
          livestockOperations: [
            {
              animalType: "cattle",
              numberOfAnimals: 150,
              averageWeight: 650.5,
              feedType: "grass-fed",
              housingType: "free-range",
            },
            {
              animalType: "sheep",
              numberOfAnimals: 300,
              averageWeight: 75.2,
              feedType: "grass-fed",
              housingType: "outdoor",
            },
            {
              animalType: "pigs",
              numberOfAnimals: 50,
              averageWeight: 180.0,
              feedType: "organic-feed",
              housingType: "barn",
            },
          ],
          totalAnimals: 500,
          organicCertified: true,
        },
      };

      const response = await wreck.post(`/grants/${grantCode}/applications`, {
        payload: applicationData,
      });
      expect(response.res.statusCode).toBe(204);

      // Verify complex array data persistence
      const dbApplication = await applications.findOne({
        clientRef: `app-service-array-${testId}`,
      });
      expect(dbApplication.phases[0].answers.livestockOperations).toHaveLength(
        3,
      );
      expect(
        dbApplication.phases[0].answers.livestockOperations[0].animalType,
      ).toBe("cattle");
      expect(
        dbApplication.phases[0].answers.livestockOperations[0].numberOfAnimals,
      ).toBe(150);
      expect(
        dbApplication.phases[0].answers.livestockOperations[1].averageWeight,
      ).toBe(75.2);
      expect(
        dbApplication.phases[0].answers.livestockOperations[2].feedType,
      ).toBe("organic-feed");
      expect(dbApplication.phases[0].answers.totalAnimals).toBe(500);
      expect(dbApplication.phases[0].answers.organicCertified).toBe(true);
    });

    it("should validate application against grant schema and reject invalid data", async () => {
      const testId = Date.now();
      const grantCode = `app-service-validation-${testId}`;

      // Create grant with strict validation rules
      const grantData = {
        code: grantCode,
        metadata: {
          description: "Grant for validation testing",
          startDate: "2025-01-01T00:00:00.000Z",
        },

        phases: [
          {
            code: "PHASE_1",
            questions: {
              $schema: "https://json-schema.org/draft/2020-12/schema",
              type: "object",
              properties: {
                email: {
                  type: "string",
                  format: "email",
                  description: "Valid email address required",
                },
                age: {
                  type: "integer",
                  minimum: 18,
                  maximum: 100,
                  description: "Age must be between 18 and 100",
                },
                phoneNumber: {
                  type: "string",
                  pattern: "^\\+?[1-9]\\d{1,14}$",
                  description: "Valid phone number required",
                },
                categories: {
                  type: "array",
                  items: {
                    type: "string",
                    enum: ["category-a", "category-b", "category-c"],
                  },
                  uniqueItems: true,
                  minItems: 1,
                },
              },
              required: ["email", "age", "phoneNumber", "categories"],
            },
            stages: [
              { code: "STAGE_1", statuses: [{ code: "NEW", validFrom: [] }] },
            ],
          },
        ],
        actions: [],
      };

      await wreck.post("/grants", {
        payload: grantData,
      });

      // Test various validation failures
      const invalidApplications = [
        {
          name: "invalid email",
          data: {
            metadata: {
              clientRef: `app-service-invalid-email-${testId}`,
              submittedAt: new Date().toISOString(),
              sbi: "123456789",
              frn: "987654321",
              crn: "555666777",
              defraId: "DEF123456",
            },
            answers: {
              email: "not-an-email",
              age: 30,
              phoneNumber: "+1234567890",
              categories: ["category-a"],
            },
          },
        },
        {
          name: "age below minimum",
          data: {
            metadata: {
              clientRef: `app-service-invalid-age-${testId}`,
              submittedAt: new Date().toISOString(),
              sbi: "123456789",
              frn: "987654321",
              crn: "555666777",
              defraId: "DEF123456",
            },
            answers: {
              email: "test@example.com",
              age: 16,
              phoneNumber: "+1234567890",
              categories: ["category-a"],
            },
          },
        },
        {
          name: "invalid phone pattern",
          data: {
            metadata: {
              clientRef: `app-service-invalid-phone-${testId}`,
              submittedAt: new Date().toISOString(),
              sbi: "123456789",
              frn: "987654321",
              crn: "555666777",
              defraId: "DEF123456",
            },
            answers: {
              email: "test@example.com",
              age: 30,
              phoneNumber: "invalid-phone",
              categories: ["category-a"],
            },
          },
        },
        {
          name: "invalid enum value",
          data: {
            metadata: {
              clientRef: `app-service-invalid-enum-${testId}`,
              submittedAt: new Date().toISOString(),
              sbi: "123456789",
              frn: "987654321",
              crn: "555666777",
              defraId: "DEF123456",
            },
            answers: {
              email: "test@example.com",
              age: 30,
              phoneNumber: "+1234567890",
              categories: ["invalid-category"],
            },
          },
        },
      ];

      // Test each validation failure
      for (const invalidApp of invalidApplications) {
        let validationError;
        try {
          await wreck.post(`/grants/${grantCode}/applications`, {
            json: true,
            payload: invalidApp.data,
          });
        } catch (error) {
          validationError = error.data.payload;
        }

        expect(
          validationError,
          `Expected validation error for ${invalidApp.name}`,
        ).toBeTruthy();
        expect(validationError.statusCode).toBe(400);
        expect(validationError.message).toContain("has invalid answers");
      }

      // Verify no invalid applications were stored
      const invalidApplicationCount = await applications.countDocuments({
        clientRef: { $regex: `^app-service-invalid-.*-${testId}$` },
      });
      expect(invalidApplicationCount).toBe(0);
    });
  });
});
