import { Verifier } from "@pact-foundation/pact";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import { env } from "node:process";
import { afterAll, describe, it } from "vitest";

// Load .env file for PACT_BROKER credentials
dotenv.config();

// MongoDB connection for state setup - use same as integration tests
const MONGO_URI = env.MONGO_URI || "mongodb://localhost:27018/fg-gas-backend";
let client;
let db;

describe("fg-gas-backend Provider Verification", () => {
  // Connect to the running service - use same ports as integration tests
  const PORT = env.GAS_PORT || 3001;
  const PROVIDER_BASE_URL = env.PROVIDER_BASE_URL || `http://localhost:${PORT}`;

  console.log("Provider Base URL:", PROVIDER_BASE_URL);

  afterAll(async () => {
    // Clean up MongoDB connection
    if (client) {
      await client.close();
    }
  });

  // Helper function for MongoDB connection
  async function ensureMongoConnection() {
    if (!client) {
      console.log("Connecting to MongoDB:", MONGO_URI);
      try {
        client = await MongoClient.connect(MONGO_URI);
        db = client.db();
        console.log("Successfully connected to MongoDB");
        return true;
      } catch (error) {
        console.warn("MongoDB connection failed:", error.message);
        return false;
      }
    }
    return true;
  }

  describe("Contract Verification", () => {
    it("should verify contracts from grants-ui consumer", async () => {
      // Debug environment variables
      console.log("Environment check:");
      console.log("- PROVIDER_BASE_URL:", env.PROVIDER_BASE_URL || "[NOT SET]");
      console.log("- PACT_USER:", env.PACT_USER ? "[SET]" : "[NOT SET]");
      console.log("- PACT_PASS:", env.PACT_PASS ? "[SET]" : "[NOT SET]");
      console.log("- Using Provider URL:", PROVIDER_BASE_URL);

      const opts = {
        provider: "fg-gas-backend",
        providerBaseUrl: PROVIDER_BASE_URL,
        pactBrokerUrl:
          env.PACT_BROKER_BASE_URL ||
          "https://ffc-pact-broker.azure.defra.cloud",
        consumerVersionSelectors: [{ latest: true }],
        pactBrokerUsername: env.PACT_USER,
        pactBrokerPassword: env.PACT_PASS,
        stateHandlers: {
          // Real state setup for proper contract verification
          "example-grant-with-auth-v3 is configured in fg-gas-backend":
            async () => {
              console.log("State: Setting up example-grant-with-auth-v3 grant");

              const connected = await ensureMongoConnection();
              if (!connected) {
                console.log(
                  "Skipping database setup - no connection available",
                );
                return Promise.resolve();
              }

              // Clear applications to prevent conflicts
              const applications = db.collection("applications");
              await applications.deleteMany({});
              console.log("Cleared existing applications");

              // Create the grant that matches the consumer contract
              const grants = db.collection("grants");
              const exampleGrant = {
                code: "example-grant-with-auth-v3",
                metadata: {
                  description: "Example Grant with Auth v3",
                  startDate: "2025-01-01T00:00:00.000Z",
                },
                actions: [],
                questions: {
                  $schema: "https://json-schema.org/draft/2020-12/schema",
                  title: "ExampleGrantWithAuthV3",
                  type: "object",
                  properties: {
                    applicantBusinessAddress__addressLine1: { type: "string" },
                    applicantBusinessAddress__addressLine2: { type: "string" },
                    applicantBusinessAddress__county: { type: "string" },
                    applicantBusinessAddress__postcode: { type: "string" },
                    applicantBusinessAddress__town: { type: "string" },
                    applicantEmail: { type: "string" },
                    applicantMobile: { type: "string" },
                    applicantName: { type: "string" },
                    autocompleteField: { type: "string" },
                    checkboxesField: { type: "array" },
                    datePartsField__day: { type: "number" },
                    datePartsField__month: { type: "number" },
                    datePartsField__year: { type: "number" },
                    monthYearField__month: { type: "number" },
                    monthYearField__year: { type: "number" },
                    multilineTextField: { type: "string" },
                    numberField: { type: "number" },
                    radiosField: { type: "string" },
                    referenceNumber: { type: "string" },
                    selectField: { type: "string" },
                    yesNoField: { type: "boolean" },
                  },
                  required: ["applicantName", "applicantEmail"],
                },
              };

              await grants.replaceOne(
                { code: "example-grant-with-auth-v3" },
                exampleGrant,
                { upsert: true },
              );
              console.log(
                "example-grant-with-auth-v3 grant successfully upserted",
              );

              // Create unique index for clientRef
              try {
                await applications.createIndex(
                  { clientRef: 1 },
                  { unique: true },
                );
                console.log("Created unique index for clientRef");
              } catch (err) {
                console.log("Index already exists or error:", err.message);
              }

              return Promise.resolve();
            },

          "adding value grant scheme is available": async () => {
            console.log(
              "State: adding value grant scheme is available (mocked)",
            );
            return Promise.resolve();
          },

          "adding value grant has minimum cost threshold": async () => {
            console.log("State: grant has minimum cost threshold (mocked)");
            return Promise.resolve();
          },

          "application submission service is available": async () => {
            console.log(
              "State: application submission service is available (mocked)",
            );
            return Promise.resolve();
          },

          "application validation is enforced": async () => {
            console.log("State: application validation is enforced (mocked)");
            return Promise.resolve();
          },

          "application AV-2024-001 exists and is under review": async () => {
            console.log("State: application AV-2024-001 exists (mocked)");
            return Promise.resolve();
          },

          "application AV-2024-999 does not exist": async () => {
            console.log(
              "State: application AV-2024-999 does not exist (mocked)",
            );
            return Promise.resolve();
          },

          "grants are available in the system": async () => {
            console.log("State: grants are available in the system (mocked)");
            return Promise.resolve();
          },

          "grant frps-private-beta exists": async () => {
            console.log("State: grant frps-private-beta exists (mocked)");
            return Promise.resolve();
          },

          "grant system is available for application submission": async () => {
            console.log(
              "State: grant system is available for application submission (mocked)",
            );
            return Promise.resolve();
          },

          "grant system validates grant codes": async () => {
            console.log("State: grant system validates grant codes (mocked)");
            return Promise.resolve();
          },

          "application with clientRef duplicate-ref-123 already exists":
            async () => {
              console.log(
                "State: application with duplicate clientRef exists (mocked)",
              );
              return Promise.resolve();
            },

          "application AV240115001 is approved and ready for agreement":
            async () => {
              console.log(
                "State: application approved and ready for agreement (mocked)",
              );
              return Promise.resolve();
            },

          "application AV240199999 does not exist": async () => {
            console.log(
              "State: application AV240199999 does not exist (mocked)",
            );
            return Promise.resolve();
          },

          "application AV240116001 exists but is still under review":
            async () => {
              console.log("State: application under review (mocked)");
              return Promise.resolve();
            },

          "application AV240115001 is approved": async () => {
            console.log("State: application is approved (mocked)");
            return Promise.resolve();
          },

          "application AV240115001 has detailed parcel information":
            async () => {
              console.log(
                "State: application has detailed parcel information (mocked)",
              );
              return Promise.resolve();
            },
        },
        requestFilter: (req, _res, next) => {
          // Add authentication headers if needed
          if (!req.headers.authorization) {
            req.headers.authorization = "Bearer test-token";
          }
          next();
        },
        customProviderHeaders: ["Authorization: Bearer test-token"],
        publishVerificationResult: true, // Publish results back to Pact Broker
        providerVersion: process.env.GIT_COMMIT || "1.0.0",
      };

      return new Verifier(opts).verifyProvider();
    });
  });
});
