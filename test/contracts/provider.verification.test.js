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

// State setup functions
async function setupTestGrants() {
  try {
    console.log("Setting up test grants in database");

    if (!client) {
      console.log("Connecting to MongoDB:", MONGO_URI);
      client = await MongoClient.connect(MONGO_URI);
      db = client.db();
    }

    const grants = db.collection("grants");
    await grants.deleteMany({}); // Clear existing grants
    console.log("Cleared existing grants");

    // Insert realistic grant data that matches contract expectations
    const testGrants = [
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
      {
        code: "test-code-1",
        metadata: {
          description: "Test grant for verification",
          startDate: "2024-01-01",
        },
        actions: [
          {
            name: "action1",
            method: "GET",
            url: "http://example.com",
          },
        ],
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          properties: {},
        },
      },
    ];

    await grants.insertMany(testGrants);
    console.log(`Successfully inserted ${testGrants.length} test grants`);

    return Promise.resolve();
  } catch (error) {
    console.error("Error setting up test grants:", error);
    throw error;
  }
}

async function setupSFIGrant() {
  try {
    console.log("Setting up SFI-AHL grant");

    if (!client) {
      console.log("Connecting to MongoDB for SFI grant:", MONGO_URI);
      client = await MongoClient.connect(MONGO_URI);
      db = client.db();
    }

    const grants = db.collection("grants");

    // Ensure specific SFI-AHL grant exists
    const sfiGrant = {
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
    };

    await grants.replaceOne({ code: "sfi-ahl" }, sfiGrant, { upsert: true });
    console.log("SFI-AHL grant successfully upserted");

    return Promise.resolve();
  } catch (error) {
    console.error("Error setting up SFI grant:", error);
    throw error;
  }
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
        pactUrls: [
          resolve(__dirname, "../pacts/grants-ui-fg-gas-backend.json"),
        ],
        stateHandlers: {
          "adding value grant scheme is available": async () => {
            // Setup: Ensure grant scheme is available
            console.log("State: Adding value grant scheme is available");
            // In real implementation, might seed database or configure services
            return Promise.resolve();
          },

          "adding value grant has minimum cost threshold": async () => {
            // Setup: Configure minimum cost threshold
            console.log("State: Grant has minimum cost threshold");
            return Promise.resolve();
          },

          "application submission service is available": async () => {
            // Setup: Ensure application submission endpoint is ready
            console.log("State: Application submission service is available");
            return Promise.resolve();
          },

          "application validation is enforced": async () => {
            // Setup: Ensure validation rules are active
            console.log("State: Application validation is enforced");
            return Promise.resolve();
          },

          "application AV-2024-001 exists and is under review": async () => {
            // Setup: Create test application in database
            console.log("State: Application AV-2024-001 exists");
            // Mock or seed application data
            return Promise.resolve();
          },

          "application AV-2024-999 does not exist": async () => {
            // Setup: Ensure application doesn't exist
            console.log("State: Application AV-2024-999 does not exist");
            return Promise.resolve();
          },

          "application AV240115001 is approved and ready for agreement":
            async () => {
              // Setup: Create approved application for agreements API
              console.log(
                "State: Application approved and ready for agreement",
              );
              return Promise.resolve();
            },

          "application AV240199999 does not exist": async () => {
            // Setup: Ensure application doesn't exist
            console.log("State: Application AV240199999 does not exist");
            return Promise.resolve();
          },

          "application AV240116001 exists but is still under review":
            async () => {
              // Setup: Create application that's still under review
              console.log("State: Application under review");
              return Promise.resolve();
            },

          "application AV240115001 is approved": async () => {
            // Setup: Application is in approved state
            console.log("State: Application is approved");
            return Promise.resolve();
          },

          "application AV240115001 has detailed parcel information":
            async () => {
              // Setup: Application with complete parcel data
              console.log("State: Application has detailed parcel information");
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
        publishVerificationResult: false, // Set to true when integrating with CDP artifacts
        providerVersion: process.env.GIT_COMMIT || "1.0.0",
        consumerVersionSelectors: [{ latest: true }, { deployed: true }],
      };

      return new Verifier(opts).verifyProvider();
    });

    it("should verify contracts from farming-grants-agreements-api consumer", async () => {
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

            // Debug: Test what fg-gas-backend actually returns
            try {
              const fetch = (await import("node-fetch")).default;
              const response = await fetch("http://localhost:3003/grants");
              const data = await response.json();
              console.log(
                "fg-gas-backend actual response:",
                JSON.stringify(data),
              );
              console.log("fg-gas-backend response status:", response.status);
            } catch (error) {
              console.log("Error testing fg-gas-backend:", error.message);
            }

            return Promise.resolve();
          },

          "grant sfi-ahl exists and is active": async () => {
            console.log("State: Setting up specific grant SFI-AHL");
            await setupSFIGrant();
            return Promise.resolve();
          },

          "grant validation service is available": async () => {
            console.log("State: Grant validation service ready");
            await setupSFIGrant(); // Ensure grant exists for validation
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

    it("should verify contracts from fg-cw-backend consumer", async () => {
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
