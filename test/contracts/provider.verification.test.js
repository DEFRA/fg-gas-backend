import { Verifier } from "@pact-foundation/pact";
import { MongoClient } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, describe, it } from "vitest";

// Use the same MongoDB URI as integration tests
const MONGO_URI = env.MONGO_URI || "mongodb://localhost:27018/fg-gas-backend";

let client;
let db;

// Helper function to ensure MongoDB connection
async function ensureMongoConnection() {
  if (!client) {
    console.log("Connecting to MongoDB:", MONGO_URI);
    client = await MongoClient.connect(MONGO_URI);
    db = client.db(); // Database name is already in the URI
  }
}

describe("fg-gas-backend Provider Verification", () => {
  // Connect to the running Docker service - use same port as integration tests
  const PORT = 3001;

  beforeAll(async () => {
    // Wait a moment to ensure service is ready
    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  afterAll(async () => {
    // Clean up MongoDB connection
    if (client) {
      await client.close();
    }
  });

  describe("Contract Verification", () => {
    it("should verify contracts from grants-ui consumer", async () => {
      const opts = {
        provider: "fg-gas-backend",
        providerBaseUrl: `http://localhost:${PORT}`,
        pactBrokerUrl:
          env.PACT_BROKER_BASE_URL ||
          env.PACT_BROKER_URL ||
          "https://ffc-pact-broker.azure.defra.cloud",
        consumerVersionSelectors: [{ latest: true }],
        pactBrokerUsername: env.PACT_BROKER_USERNAME,
        pactBrokerPassword: env.PACT_BROKER_PASSWORD,
        stateHandlers: {
          "example-grant-with-auth-v3 is configured in fg-gas-backend":
            async () => {
              console.log("State: Setting up example-grant-with-auth-v3 grant");
              await ensureMongoConnection();

              // Clear applications collection to prevent 409 conflicts
              const applications = db.collection("applications");
              await applications.deleteMany({});
              console.log("Cleared existing applications");

              // Set up the grant
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

              // Create unique index for clientRef to handle duplicates properly
              try {
                await applications.createIndex(
                  { clientRef: 1 },
                  { unique: true },
                );
                console.log("Created unique index for clientRef");
              } catch (err) {
                console.log(
                  "Unique index already exists or error:",
                  err.message,
                );
              }

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
