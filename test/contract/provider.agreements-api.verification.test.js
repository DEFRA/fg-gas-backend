// test/contract/provider.agreements-api.verification.test.js
// Contract test for SNS messages consumed by farming-grants-agreements-api
import { Verifier } from "@pact-foundation/pact";
import { afterAll, beforeAll, describe, it } from "vitest";
import domainAgreementCreated from "./fixtures/agreement-created-domain.json";
import domainAgreementWithdrawn from "./fixtures/agreement-withdrawn-domain.json";

// Generate real messages using actual CloudEvent classes with domain fixtures
async function generateAgreementCreatedMessage() {
  const { CreateAgreementCommand } = await import(
    "../../src/grants/events/create-agreement.command.js"
  );

  // Create mock application that mimics real Application domain model
  // NOTE: Consumer expects additional fields (agreementNumber, createdAt, submittedAt, notificationMessageId)
  // but our current implementation doesn't include them. See CONTRACT_ISSUES.md
  const mockApplication = {
    clientRef: domainAgreementCreated.clientRef,
    code: domainAgreementCreated.code,
    identifiers: domainAgreementCreated.identifiers,
    metadata: domainAgreementCreated.metadata,
    getAnswers: () => domainAgreementCreated.answers,
  };

  const realEvent = new CreateAgreementCommand(mockApplication);

  console.log(
    "=== Agreement Created Message (for farming-grants-agreements-api) ===",
  );
  console.log(JSON.stringify(realEvent, null, 2));

  return realEvent;
}

async function generateAgreementWithdrawnMessage() {
  // Using existing UpdateAgreementStatusCommand (will fail contract test)
  // Consumer expects 'agreement.withdraw' but we send 'agreement.status.update'
  const { UpdateAgreementStatusCommand } = await import(
    "../../src/grants/events/update-agreement-status.command.js"
  );

  const realEvent = new UpdateAgreementStatusCommand({
    clientRef: domainAgreementWithdrawn.clientRef,
    status: domainAgreementWithdrawn.status,
    agreementNumber: domainAgreementWithdrawn.id,
  });

  console.log(
    "=== Agreement Withdrawn Message (for farming-grants-agreements-api) ===",
  );
  console.log(JSON.stringify(realEvent, null, 2));

  return realEvent;
}

describe("fg-gas-backend Provider Verification (Agreements API Consumer)", () => {
  let mockServer;
  let mockPort;

  beforeAll(async () => {
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

    // HTTP server to serve CloudEvents for PACT message verification
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
          `Mock server started on port ${mockPort} for farming-grants-agreements-api consumer`,
        );
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (mockServer) {
      mockServer.close();
    }
  });

  describe("SNS Message Verification", () => {
    it("should verify SNS messages against farming-grants-agreements-api consumer contract", async () => {
      console.log(
        "Verifying SNS messages for farming-grants-agreements-api consumer",
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
          const realEvent = await generateAgreementCreatedMessage();
          return realEvent;
        },
        "An agreement withdrawn message": async () => {
          const realEvent = await generateAgreementWithdrawnMessage();
          return realEvent;
        },
      };

      const opts = {
        provider: "fg-gas-backend",
        providerBaseUrl: `http://localhost:${mockPort}`,
        messages: true,
        stateHandlers,
        messageProviders,
        providerVersion:
          process.env.GIT_COMMIT || process.env.npm_package_version || "dev",
        pactBrokerUrl:
          process.env.PACT_BROKER_BASE_URL ||
          "https://ffc-pact-broker.azure.defra.cloud",
        consumerVersionSelectors: [
          { consumer: "farming-grants-agreements-api", latest: true },
        ],
        pactBrokerUsername: process.env.PACT_USER,
        pactBrokerPassword: process.env.PACT_PASS,
        publishVerificationResult:
          process.env.PACT_PUBLISH_VERIFICATION === "true",
        logLevel: process.env.PACT_LOG_LEVEL || "INFO",
      };

      return new Verifier(opts).verifyProvider();
    }, 120000);
  });
});
