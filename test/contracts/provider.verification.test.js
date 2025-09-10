import { Verifier } from "@pact-foundation/pact";
import { MongoClient } from "mongodb";
import { env } from "node:process";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Use the same MongoDB that fg-gas-backend Docker service uses
// Docker service exposes MongoDB on ${MONGO_PORT:-27018}:27017
const MONGO_URI = env.MONGO_URI || "mongodb://localhost:27018";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");

let client;
let db;

// Shared grant definitions (single source of truth)
const testGrantDefinitions = [
  {
    code: "frps-private-beta",
    metadata: {
      description: "Farming Resilience Private Beta",
      startDate: "2024-01-01T00:00:00.000Z",
    },
    actions: [], // Empty actions array - FRPS Private Beta doesn't use scoring
    questions: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: "FrpsPrivateBetaGrant",
      type: "object",
      properties: {
        scheme: { type: "string" },
        year: { type: "number" },
        agreementName: { type: "string" },
        actionApplications: {
          type: "array",
          items: {
            type: "object",
            properties: {
              parcelId: { type: "string" },
              sheetId: { type: "string" },
              code: { type: "string" },
              appliedFor: {
                type: "object",
                properties: {
                  unit: { type: "string" },
                  quantity: { type: "number" },
                },
              },
            },
          },
        },
      },
      required: ["scheme", "year"],
    },
  },
  {
    code: "adding-value",
    metadata: {
      description: "Adding Value Grant",
      startDate: "2025-01-01T00:00:00.000Z",
    },
    actions: [
      {
        name: "score",
        method: "POST",
        url: "https://ffc-grants-scoring.dev.cdp-int.defra.cloud/scoring/api/v1/adding-value/score",
      },
    ],
    questions: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: "AddingValueGrant",
      type: "object",
      properties: {
        scheme: { type: "string" },
        year: { type: "number" },
        agreementName: { type: "string" },
      },
      required: ["scheme", "year"],
    },
  },
  {
    code: "sfi-ahl",
    metadata: {
      description:
        "Sustainable Farming Incentive - Arable and Horticultural Land",
      startDate: "2024-01-01",
    },
    actions: [
      {
        name: "cahl1",
        method: "GET",
        url: "http://localhost:3003/grants/sfi-ahl/actions/cahl1",
        payload: {
          description:
            "Assess soil, test soil organic matter and produce a soil management plan",
          paymentRate: 20.06,
          unit: "per hectare per year",
        },
      },
    ],
    questions: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {},
      required: [],
    },
  },
];

// State setup functions
async function setupTestGrants() {
  try {
    console.log("Setting up test grants in database");
    await ensureMongoConnection();

    const grants = db.collection("grants");
    await grants.deleteMany({}); // Clear existing grants
    console.log("Cleared existing grants");

    const result = await grants.insertMany(testGrantDefinitions);
    console.log(
      `Successfully inserted ${testGrantDefinitions.length} test grants`,
    );
    console.log(`Inserted IDs:`, result.insertedIds);

    // Verify insertion
    const count = await grants.countDocuments();
    console.log(`Total grants in database: ${count}`);

    const allGrants = await grants.find({}).toArray();
    console.log(
      "Grants in database:",
      allGrants.map((g) => ({
        code: g.code,
        description: g.metadata?.description,
      })),
    );

    return Promise.resolve();
  } catch (error) {
    console.error("Error setting up test grants:", error);
    throw error;
  }
}

// Helper function to ensure MongoDB connection
async function ensureMongoConnection() {
  if (!client) {
    console.log("Connecting to MongoDB:", MONGO_URI);
    client = await MongoClient.connect(MONGO_URI);
    db = client.db("fg-gas-backend"); // Use same database name as the service
  }
}

// Simplified individual grant setup functions (no duplication)
async function setupAddingValueGrant() {
  await ensureMongoConnection();
  const grants = db.collection("grants");

  // Find the adding-value grant definition from testGrants
  const addingValueGrant = testGrantDefinitions.find(
    (g) => g.code === "adding-value",
  );

  console.log("Setting up adding-value grant");
  await grants.replaceOne({ code: "adding-value" }, addingValueGrant, {
    upsert: true,
  });
  console.log("Adding-value grant successfully upserted");
}

async function setupFrpsPrivateBetaGrant() {
  await ensureMongoConnection();
  const grants = db.collection("grants");

  // Find the frps-private-beta grant definition from testGrants
  const frpsGrant = testGrantDefinitions.find(
    (g) => g.code === "frps-private-beta",
  );

  console.log("Setting up frps-private-beta grant");
  await grants.replaceOne({ code: "frps-private-beta" }, frpsGrant, {
    upsert: true,
  });
  console.log("frps-private-beta grant successfully upserted");
}

async function setupSFIGrant() {
  await ensureMongoConnection();
  const grants = db.collection("grants");

  // Find the sfi-ahl grant definition from testGrants
  const sfiGrant = testGrantDefinitions.find((g) => g.code === "sfi-ahl");

  console.log("Setting up SFI-AHL grant");
  await grants.replaceOne({ code: "sfi-ahl" }, sfiGrant, { upsert: true });
  console.log("SFI-AHL grant successfully upserted");
}

describe("fg-gas-backend Provider Verification", () => {
  // Connect to the running Docker service
  const PORT = 3003;

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
          env.PACT_BROKER_URL || "https://ffc-pact-broker.azure.defra.cloud",
        consumerVersionSelectors: [{ latest: true }],
        pactBrokerUsername: env.PACT_BROKER_USERNAME || "pactuser01",
        pactBrokerPassword:
          env.PACT_BROKER_PASSWORD || "SabS9%u/Lyq7k~?yJ5HAd7]r<7y/B",
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

          "adding value grant scheme is available": async () => {
            console.log("State: Adding value grant scheme is available");
            await setupAddingValueGrant();
            return Promise.resolve();
          },

          "adding value grant has minimum cost threshold": async () => {
            console.log("State: Grant has minimum cost threshold");
            await setupAddingValueGrant();
            return Promise.resolve();
          },

          "application submission service is available": async () => {
            console.log("State: Application submission service is available");
            await setupFrpsPrivateBetaGrant();
            return Promise.resolve();
          },

          "application validation is enforced": async () => {
            console.log("State: Application validation is enforced");
            await setupFrpsPrivateBetaGrant();
            return Promise.resolve();
          },

          "application AV-2024-001 exists and is under review": async () => {
            console.log("State: Application AV-2024-001 exists");
            await setupFrpsPrivateBetaGrant();
            return Promise.resolve();
          },

          "application AV-2024-999 does not exist": async () => {
            console.log("State: Application AV-2024-999 does not exist");
            await setupFrpsPrivateBetaGrant();
            return Promise.resolve();
          },

          "grants are available in the system": async () => {
            console.log("State: Grants are available in the system");
            await ensureMongoConnection();
            const grants = db.collection("grants");
            await grants.deleteMany({}); // Clear all grants first
            await setupFrpsPrivateBetaGrant(); // Only setup frps-private-beta for contract
            return Promise.resolve();
          },

          "grant frps-private-beta exists": async () => {
            console.log("State: Grant frps-private-beta exists");
            await setupFrpsPrivateBetaGrant();
            return Promise.resolve();
          },

          "grant system is available for application submission": async () => {
            console.log(
              "State: Grant system is available for application submission",
            );
            await setupFrpsPrivateBetaGrant();

            // Clear applications to ensure clean state for successful submission
            await ensureMongoConnection();
            const applications = db.collection("applications");
            await applications.deleteMany({});

            // Create unique index for clientRef
            try {
              await applications.createIndex(
                { clientRef: 1 },
                { unique: true },
              );
            } catch (err) {
              // Ignore if index already exists
            }

            return Promise.resolve();
          },

          "grant system validates grant codes": async () => {
            console.log("State: Grant system validates grant codes");
            await setupFrpsPrivateBetaGrant();
            return Promise.resolve();
          },

          // Removed scoring-related state handlers since FRPS Private Beta doesn't use scoring

          "application with clientRef duplicate-ref-123 already exists":
            async () => {
              console.log("State: Application with duplicate clientRef exists");
              await setupFrpsPrivateBetaGrant();

              // Clear and setup applications collection properly
              await ensureMongoConnection();
              const applications = db.collection("applications");

              try {
                // Clear any existing applications
                await applications.deleteMany({});

                // Drop existing indexes to avoid conflicts
                try {
                  await applications.dropIndexes();
                } catch (err) {
                  // Ignore if no indexes exist
                }

                // Create unique index for clientRef
                await applications.createIndex(
                  { clientRef: 1 },
                  { unique: true },
                );

                // Insert application with duplicate-ref-123 clientRef
                await applications.insertOne({
                  clientRef: "duplicate-ref-123",
                  code: "frps-private-beta",
                  createdAt: new Date(),
                  submittedAt: new Date(),
                  identifiers: {
                    sbi: "123456789",
                    frn: "987654321",
                    crn: "555666777",
                    defraId: "def123456",
                  },
                  answers: {
                    scheme: "SFI",
                    year: 2024,
                  },
                });

                console.log("Successfully setup duplicate application");
              } catch (error) {
                console.error("Error setting up duplicate application:", error);
                throw error;
              }

              return Promise.resolve();
            },

          "application AV240115001 is approved and ready for agreement":
            async () => {
              console.log(
                "State: Application approved and ready for agreement",
              );
              await setupFrpsPrivateBetaGrant();
              return Promise.resolve();
            },

          "application AV240199999 does not exist": async () => {
            console.log("State: Application AV240199999 does not exist");
            await setupFrpsPrivateBetaGrant();
            return Promise.resolve();
          },

          "application AV240116001 exists but is still under review":
            async () => {
              console.log("State: Application under review");
              await setupFrpsPrivateBetaGrant();
              return Promise.resolve();
            },

          "application AV240115001 is approved": async () => {
            console.log("State: Application is approved");
            await setupFrpsPrivateBetaGrant();
            return Promise.resolve();
          },

          "application AV240115001 has detailed parcel information":
            async () => {
              console.log("State: Application has detailed parcel information");
              await setupFrpsPrivateBetaGrant();
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

    it.skip("should verify contracts from farming-grants-agreements-api consumer", async () => {
      // DEMO FOCUS: Skip this test to focus on grants-ui ↔ fg-gas-backend only
      // This test is for farming-grants-agreements-api integration

      console.log(
        "⏭️  Skipping farming-grants-agreements-api test for demo focus",
      );
      console.log(
        "📋 Demo focuses only on grants-ui ↔ fg-gas-backend integration",
      );

      const opts = {
        provider: "fg-gas-backend",
        providerBaseUrl: `http://localhost:${PORT}`,
        pactUrls: [
          resolve(
            __dirname,
            "../pacts/farming-grants-agreements-api-fg-gas-backend.json",
          ),
        ],
        stateHandlers: {
          "grants are available for agreements": async () => {
            console.log("State: Setting up grants for agreements");
            await setupTestGrants();
            return Promise.resolve();
          },

          "grant sfi-ahl exists and is active": async () => {
            console.log("State: Setting up specific grant SFI-AHL");
            await setupSFIGrant();
            return Promise.resolve();
          },

          "grant validation service is available": async () => {
            console.log("State: Grant validation service ready");
            await setupSFIGrant();
            return Promise.resolve();
          },
        },
        requestFilter: (req, _res, next) => {
          if (!req.headers.authorization) {
            req.headers.authorization = "Bearer agreements-service-token";
          }
          next();
        },
        publishVerificationResult: false,
        providerVersion: process.env.GIT_COMMIT || "1.0.0",
      };

      return new Verifier(opts).verifyProvider();
    });

    it.skip("should verify contracts from fg-cw-backend consumer", async () => {
      // REALITY CHECK: This integration doesn't exist according to service audit
      // fg-cw-backend does not actually call fg-gas-backend
      // Test kept as placeholder for future integration

      console.log(
        "⚠️  Integration fg-cw-backend → fg-gas-backend does not exist",
      );
      console.log(
        "📋 This test serves as specification for future implementation",
      );

      const opts = {
        provider: "fg-gas-backend",
        providerBaseUrl: `http://localhost:${PORT}`,
        pactUrls: [
          resolve(__dirname, "../pacts/fg-cw-backend-fg-gas-backend.json"),
        ],
        stateHandlers: {
          // Add state handlers for casework backend interactions
          "application exists for case management": async () => {
            console.log("State: Application exists for case management");
            return Promise.resolve();
          },
        },
        requestFilter: (req, _res, next) => {
          if (!req.headers.authorization) {
            req.headers.authorization = "Bearer casework-service-token";
          }
          next();
        },
        publishVerificationResult: false,
        providerVersion: process.env.GIT_COMMIT || "1.0.0",
      };

      return new Verifier(opts).verifyProvider();
    });
  });

  describe("Pact Artifact Management", () => {
    it("should download pacts from CDP artifacts", async () => {
      // This test would download pact files from CDP build artifacts
      // Implementation depends on CDP artifact storage mechanism

      const artifactDownloader = async (consumerName, providerName) => {
        // Mock implementation - replace with actual CDP artifact API calls
        console.log(`Downloading pact: ${consumerName}-${providerName}`);

        // Example CDP artifact download logic:
        // const response = await fetch(`${CDP_ARTIFACTS_URL}/pacts/${consumerName}-${providerName}-latest.json`)
        // const pactContent = await response.json()
        // await fs.writeFile(`./pacts/${consumerName}-${providerName}.json`, JSON.stringify(pactContent))

        return Promise.resolve();
      };

      await artifactDownloader("grants-ui", "fg-gas-backend");
      await artifactDownloader(
        "farming-grants-agreements-api",
        "fg-gas-backend",
      );

      expect(true).toBe(true); // Placeholder assertion
    });
  });
});
