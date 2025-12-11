// test/contract/provider.sns.verification.test.js
import { Verifier } from "@pact-foundation/pact";
import { afterAll, beforeAll, describe, it } from "vitest";

// Contract data structure reference (auto-synced from PACT broker)
let contractDataReference = {};

// Generate real messages using actual CloudEvent classes
async function generateAgreementCreatedMessage() {
  const { AgreementCreatedEvent } = await import("../../src/grants/events/agreement-created.event.js");
  
  const realEvent = new AgreementCreatedEvent({
    agreementNumber: "SFI987654321",
    answers: contractDataReference.createdMessage?.data?.answers || {},
    clientRef: "client-ref-002",
    code: "frps-private-beta",
    createdAt: "2025-08-19T09:36:45.131Z",
    identifiers: { crn: "crn", defraId: "defraId", frn: "frn", sbi: "106284736" },
    notificationMessageId: "sample-notification-2",
    submittedAt: "2025-08-19T09:36:44.509Z",
  });
  
  // Return the REAL CloudEvent as-is - let it fail if there are contract violations!
  return realEvent;
}

async function generateAgreementWithdrawnMessage() {
  const { AgreementWithdrawnEvent } = await import("../../src/grants/events/agreement-withdrawn.event.js");
  
  const realEvent = new AgreementWithdrawnEvent({
    clientRef: "client-ref-002",
    id: "123e4567-e89b-12d3-a456-426614174000",
    status: "PRE_AWARD:APPLICATION:WITHDRAWAL_REQUESTED",
    withdrawnAt: "2025-03-27T14:30:00Z",
    withdrawnBy: "Caseworker_ID_123",
  });
  
  // Return the REAL CloudEvent as-is - let it fail if there are contract violations!
  return realEvent;
}

describe("fg-gas-backend-sns Provider Verification", () => {
  let mockServer;
  let mockPort;

  beforeAll(async () => {
    // Load current contract data reference for realistic CloudEvent generation
    try {
      const { readFileSync } = await import("fs");
      const contractData = JSON.parse(readFileSync("test/contract/contract-data.json", "utf8"));
      contractDataReference = {
        createdMessage: contractData.contractData["an agreement created message"],
        withdrawnMessage: contractData.contractData["an agreement withdrawn message"]
      };
      console.log(`📋 Loaded contract data reference (last updated: ${contractData.lastUpdated})`);
    } catch (error) {
      console.warn("⚠️ Could not load contract data reference, using minimal structure:", error.message);
      contractDataReference = {
        createdMessage: { data: { answers: {} } },
        withdrawnMessage: { data: {} }
      };
    }

    // Set environment for real CloudEvent classes
    process.env.SERVICE_NAME = "fg-gas-backend";
    process.env.SERVICE_VERSION = "test";
    process.env.PORT = "0";
    process.env.LOG_ENABLED = "false";
    process.env.LOG_LEVEL = "error";
    process.env.LOG_FORMAT = "pino-pretty";
    process.env.MONGO_URI = "mongodb://mocked-mongo/test";
    process.env.MONGO_DATABASE = "test";
    process.env.TRACING_HEADER = "x-test";
    process.env.AWS_REGION = "eu-west-2";
    process.env.ENVIRONMENT = "test";
    process.env.OUTBOX_MAX_RETRIES = "5";
    process.env.OUTBOX_CLAIM_MAX_RECORDS = "2";
    process.env.OUTBOX_EXPIRES_MS = "5000";
    process.env.OUTBOX_POLL_MS = "1000";
    process.env.INBOX_MAX_RETRIES = "5";
    process.env.INBOX_CLAIM_MAX_RECORDS = "2";
    process.env.INBOX_EXPIRES_MS = "5000";
    process.env.INBOX_POLL_MS = "1000";

    // HTTP server required by PACT v15 - serves the REAL generated CloudEvent messages
    const { createServer } = await import("http");
    mockServer = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString();
      });
      req.on("end", async () => {
        try {
          const requestData = JSON.parse(body || "{}");
          const isCreatedMessage = requestData.description?.includes("created");

          // Generate and serve REAL CloudEvent messages (will show actual contract violations)
          let realMessage;
          if (isCreatedMessage) {
            realMessage = await generateAgreementCreatedMessage();
          } else {
            realMessage = await generateAgreementWithdrawnMessage();
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(realMessage)); // Real CloudEvent with potential bugs
        } catch (error) {
          console.error("HTTP server error:", error);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: error.message }));
        }
      });
    });

    await new Promise((resolve) => {
      mockServer.listen(0, () => {
        mockPort = mockServer.address().port;
        console.log(`HTTP server started on port ${mockPort} - serving REAL CloudEvents`);
        resolve();
      });
    });
  }, 30000); // Increased timeout for auto-sync operation

  afterAll(async () => {
    if (mockServer) {
      mockServer.close();
    }
  });

  describe("SNS Message Verification", () => {
    it("should verify SNS messages for agreement events", async () => {
      console.log("Running SNS provider verification with REAL CloudEvent implementation");

      const stateHandlers = {
        "agreement created event": async () => {
          console.log("State: Agreement created event");
        },
        "agreement offer withdrawn event": async () => {
          console.log("State: Agreement offer withdrawn event");
        },
      };

      const messageProviders = {
        "An agreement created message": async () => {
          // Generate using REAL CloudEvent class - will catch implementation bugs!
          const realEvent = await generateAgreementCreatedMessage();
          return realEvent; // Real CloudEvent from production class
        },
        "An agreement withdrawn message": async () => {
          // Generate using REAL CloudEvent class - will catch implementation bugs!
          const realEvent = await generateAgreementWithdrawnMessage();
          return realEvent; // Real CloudEvent from production class
        },
      };

      const opts = {
        provider: "fg-gas-backend-sns",
        providerBaseUrl: `http://localhost:${mockPort}`,
        messages: true, // CRITICAL: tells PACT this is message verification
        stateHandlers,
        messageProviders,
        providerVersion: process.env.GIT_COMMIT || process.env.npm_package_version || "dev",
        pactUrls: [
          "https://ffc-pact-broker.azure.defra.cloud/pacts/provider/fg-gas-backend-sns/consumer/farming-grants-agreements-api-sqs/latest",
        ],
        pactBrokerUsername: process.env.PACT_USER,
        pactBrokerPassword: process.env.PACT_PASS,
        publishVerificationResult: process.env.PACT_PUBLISH_VERIFICATION === "true",
        logLevel: process.env.PACT_LOG_LEVEL || "INFO",
      };

      console.log("SNS Verifier opts structure:", {
        provider: opts.provider,
        messages: opts.messages,
        stateHandlers: Object.keys(opts.stateHandlers),
        messageProviders: Object.keys(opts.messageProviders),
        pactUrls: opts.pactUrls,
        publishVerificationResult: opts.publishVerificationResult,
      });

      // This will now test REAL CloudEvent implementation against consumer contract
      return new Verifier(opts).verifyProvider();
    }, 120000);
  });
});