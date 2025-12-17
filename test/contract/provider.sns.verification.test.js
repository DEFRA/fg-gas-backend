// test/contract/provider.sns.verification.test.js
import { Verifier } from "@pact-foundation/pact";
import { afterAll, beforeAll, describe, it } from "vitest";
import domainAgreementCreated from "./fixtures/agreement-created-domain.json";
import domainAgreementWithdrawn from "./fixtures/agreement-withdrawn-domain.json";

// Generate real messages using actual CloudEvent classes with domain fixtures
async function generateAgreementCreatedMessage() {
  // Use the REAL event class that production actually uses
  const { CreateAgreementCommand } = await import(
    "../../src/grants/events/create-agreement.command.js"
  );

  // Create mock application that mimics real Application domain model
  const mockApplication = {
    clientRef: domainAgreementCreated.clientRef,
    code: domainAgreementCreated.code,
    identifiers: domainAgreementCreated.identifiers,
    getAnswers: () => domainAgreementCreated.answers, // Real method that returns answers
  };

  const realEvent = new CreateAgreementCommand(mockApplication);

  // Log the actual result we're returning to PACT
  console.log(
    "=== ACTUAL RESULT (Agreement Created - REAL CreateAgreementCommand) ===",
  );
  console.log(JSON.stringify(realEvent, null, 2));
  console.log(
    "========================================================================",
  );

  // Return the REAL CloudEvent that production actually sends!
  return realEvent;
}

async function generateAgreementWithdrawnMessage() {
  // Use the REAL event class that production actually uses
  const { UpdateAgreementStatusCommand } = await import(
    "../../src/grants/events/update-agreement-status.command.js"
  );

  // Use real withdraw data structure that production sends
  const realEvent = new UpdateAgreementStatusCommand({
    clientRef: domainAgreementWithdrawn.clientRef,
    status: domainAgreementWithdrawn.status,
    agreementNumber: domainAgreementWithdrawn.id,
  });

  // Log the actual result we're returning to PACT
  console.log(
    "=== ACTUAL RESULT (Agreement Withdrawn - REAL UpdateAgreementStatusCommand) ===",
  );
  console.log(JSON.stringify(realEvent, null, 2));
  console.log(
    "==================================================================================",
  );

  // Return the REAL CloudEvent that production actually sends!
  return realEvent;
}

describe("fg-gas-backend-sns Provider Verification", () => {
  let mockServer;
  let mockPort;

  beforeAll(async () => {
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

    // HTTP server required by PACT v15 - serves real CloudEvents from domain fixtures
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

          // Generate real CloudEvent from domain fixtures
          let realMessage;
          if (isCreatedMessage) {
            realMessage = await generateAgreementCreatedMessage();
          } else {
            realMessage = await generateAgreementWithdrawnMessage();
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(realMessage));
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
        console.log(
          `HTTP server started on port ${mockPort} - serving real CloudEvents from domain fixtures`,
        );
        resolve();
      });
    });

    console.log("✅ Environment setup complete for real CloudEvent testing");
  });

  afterAll(async () => {
    if (mockServer) {
      mockServer.close();
    }
  });

  describe("SNS Message Verification", () => {
    it("should verify SNS messages for agreement events", async () => {
      console.log(
        "Running SNS provider verification with REAL domain fixtures",
      );

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
          // Generate using REAL CloudEvent class with OUR domain data
          const realEvent = await generateAgreementCreatedMessage();
          console.log("Generated real CloudEvent from domain fixture");
          return realEvent; // Real CloudEvent from our domain model
        },
        "An agreement withdrawn message": async () => {
          // Generate using REAL CloudEvent class with OUR domain data
          const realEvent = await generateAgreementWithdrawnMessage();
          console.log("Generated real CloudEvent from domain fixture");
          return realEvent; // Real CloudEvent from our domain model
        },
      };

      const opts = {
        provider: "fg-gas-backend-sns",
        providerBaseUrl: `http://localhost:${mockPort}`,
        messages: true, // Pure message verification
        stateHandlers,
        messageProviders,
        providerVersion:
          process.env.GIT_COMMIT || process.env.npm_package_version || "dev",
        pactUrls: [
          "https://ffc-pact-broker.azure.defra.cloud/pacts/provider/fg-gas-backend-sns/consumer/farming-grants-agreements-api-sqs/latest",
        ],
        pactBrokerUsername: process.env.PACT_USER,
        pactBrokerPassword: process.env.PACT_PASS,
        publishVerificationResult:
          process.env.PACT_PUBLISH_VERIFICATION === "true",
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

      // This tests OUR domain data through REAL CloudEvent classes against consumer contract
      return new Verifier(opts).verifyProvider();
    }, 120000);
  });
});
