// test/contract/provider.sns.verification.test.js
import { Verifier } from "@pact-foundation/pact";
import { afterAll, beforeAll, describe, it } from "vitest";

// Generate real messages using actual CloudEvent classes
async function generateAgreementCreatedMessage() {
  const { AgreementCreatedEvent } = await import(
    "../../src/grants/events/agreement-created.event.js"
  );

  const realEvent = new AgreementCreatedEvent({
    agreementNumber: "SFI987654321",
    answers: {
      actionApplications: [],
      agreementName: "Example agreement 2",
      applicant: {
        business: {
          address: {
            city: "Clitheroe",
            line1: "Mason House Farm Clitheroe Rd",
            line2: "Bashall Eaves",
            line3: null,
            line4: null,
            line5: null,
            postalCode: "BB7 3DD",
            street: "Bartindale Road",
          },
          email: {
            address:
              "cliffspencetasabbeyfarmf@mrafyebbasatecnepsffilcm.com.test",
          },
          name: "J&S Hartley",
          phone: {
            mobile: "01234031670",
          },
        },
        customer: {
          name: {
            first: "Edward",
            last: "Jones",
            middle: "Paul",
            title: "Mr.",
          },
        },
      },
      application: {
        _id: "69262bb2331fd3b45b76ee90",
        agreement: [],
        parcel: [
          {
            _id: "69262bb2331fd3b45b76ee91",
            actions: [
              {
                _id: "69262bb2331fd3b45b76ee93",
                appliedFor: {
                  _id: "69262bb2331fd3b45b76ee94",
                  quantity: 4.7575,
                  unit: "ha",
                },
                code: "CMOR1",
                durationYears: 3,
                version: 1,
              },
            ],
            area: {
              _id: "69262bb2331fd3b45b76ee92",
              quantity: 5.2182,
              unit: "ha",
            },
            parcelId: "8083",
            sheetId: "SD6743",
          },
          {
            _id: "69262bb2331fd3b45b76ee97",
            actions: [
              {
                _id: "69262bb2331fd3b45b76ee99",
                appliedFor: {
                  _id: "69262bb2331fd3b45b76ee9a",
                  quantity: 2.1705,
                  unit: "ha",
                },
                code: "CMOR1",
                durationYears: 3,
                version: 1,
              },
            ],
            area: {
              _id: "69262bb2331fd3b45b76ee98",
              quantity: 2.1703,
              unit: "ha",
            },
            parcelId: "8084",
            sheetId: "SD6743",
          },
        ],
      },
      hasCheckedLandIsUpToDate: true,
      payment: {
        agreementEndDate: "2028-09-01",
        agreementLevelItems: {
          1: {
            annualPaymentPence: 27200,
            code: "CMOR1",
            description: "CMOR1: Assess moorland and produce a written record",
            version: 1,
          },
        },
        agreementStartDate: "2025-09-01",
        agreementTotalPence: 96018,
        annualTotalPence: 32006,
        frequency: "Quarterly",
        parcelItems: {
          1: {
            annualPaymentPence: 4806,
            code: "CMOR1",
            description: "CMOR1: Assess moorland and produce a written record",
            parcelId: "8083",
            quantity: 4.53411078,
            rateInPence: 1060,
            sheetId: "SD6743",
            unit: "ha",
            version: 1,
          },
        },
        payments: [
          {
            lineItems: [
              {
                parcelItemId: 1,
                paymentPence: 1204,
              },
              {
                agreementLevelItemId: 1,
                paymentPence: 6803,
              },
            ],
            paymentDate: "2025-12-05",
            totalPaymentPence: 8007,
          },
          {
            lineItems: [
              {
                parcelItemId: 1,
                paymentPence: 1201,
              },
              {
                agreementLevelItemId: 1,
                paymentPence: 6800,
              },
            ],
            paymentDate: "2026-03-05",
            totalPaymentPence: 8001,
          },
          {
            lineItems: [
              {
                parcelItemId: 1,
                paymentPence: 1201,
              },
              {
                agreementLevelItemId: 1,
                paymentPence: 6800,
              },
            ],
            paymentDate: "2026-06-05",
            totalPaymentPence: 8001,
          },
          {
            lineItems: [
              {
                parcelItemId: 1,
                paymentPence: 1201,
              },
              {
                agreementLevelItemId: 1,
                paymentPence: 6800,
              },
            ],
            paymentDate: "2026-09-07",
            totalPaymentPence: 8001,
          },
          {
            lineItems: [
              {
                parcelItemId: 1,
                paymentPence: 1201,
              },
              {
                agreementLevelItemId: 1,
                paymentPence: 6800,
              },
            ],
            paymentDate: "2026-12-07",
            totalPaymentPence: 8001,
          },
          {
            lineItems: [
              {
                parcelItemId: 1,
                paymentPence: 1201,
              },
              {
                agreementLevelItemId: 1,
                paymentPence: 6800,
              },
            ],
            paymentDate: "2027-03-05",
            totalPaymentPence: 8001,
          },
          {
            lineItems: [
              {
                parcelItemId: 1,
                paymentPence: 1201,
              },
              {
                agreementLevelItemId: 1,
                paymentPence: 6800,
              },
            ],
            paymentDate: "2027-06-07",
            totalPaymentPence: 8001,
          },
          {
            lineItems: [
              {
                parcelItemId: 1,
                paymentPence: 1201,
              },
              {
                agreementLevelItemId: 1,
                paymentPence: 6800,
              },
            ],
            paymentDate: "2027-09-06",
            totalPaymentPence: 8001,
          },
          {
            lineItems: [
              {
                parcelItemId: 1,
                paymentPence: 1201,
              },
              {
                agreementLevelItemId: 1,
                paymentPence: 6800,
              },
            ],
            paymentDate: "2027-12-06",
            totalPaymentPence: 8001,
          },
          {
            lineItems: [
              {
                parcelItemId: 1,
                paymentPence: 1201,
              },
              {
                agreementLevelItemId: 1,
                paymentPence: 6800,
              },
            ],
            paymentDate: "2028-03-06",
            totalPaymentPence: 8001,
          },
          {
            lineItems: [
              {
                parcelItemId: 1,
                paymentPence: 1201,
              },
              {
                agreementLevelItemId: 1,
                paymentPence: 6800,
              },
            ],
            paymentDate: "2028-06-05",
            totalPaymentPence: 8001,
          },
          {
            lineItems: [
              {
                parcelItemId: 1,
                paymentPence: 1201,
              },
              {
                agreementLevelItemId: 1,
                paymentPence: 6800,
              },
            ],
            paymentDate: "2028-09-05",
            totalPaymentPence: 8001,
          },
        ],
      },
      scheme: "SFI",
      year: 2025,
    },
    clientRef: "client-ref-002",
    code: "frps-private-beta",
    createdAt: "2025-08-19T09:36:45.131Z",
    identifiers: {
      crn: "crn",
      defraId: "defraId",
      frn: "frn",
      sbi: "106284736",
    },
    notificationMessageId: "sample-notification-2",
    submittedAt: "2025-08-19T09:36:44.509Z",
  });

  // Return the REAL CloudEvent as-is - let it fail if there are contract violations!
  return realEvent;
}

async function generateAgreementWithdrawnMessage() {
  // Import here to avoid config issues at module load
  const { AgreementWithdrawnEvent } = await import(
    "../../src/grants/events/agreement-withdrawn.event.js"
  );

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

// Messages will be generated using real CloudEvent classes in beforeAll
let agreementCreatedMessage;
let agreementWithdrawnMessage;

describe("fg-gas-backend-sns Provider Verification", () => {
  let mockServer;
  let mockPort;

  beforeAll(async () => {
    // Set environment for real CloudEvent classes first
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

    // Generate messages using real CloudEvent classes (will catch implementation bugs!)
    agreementCreatedMessage = await generateAgreementCreatedMessage();
    agreementWithdrawnMessage = await generateAgreementWithdrawnMessage();

    console.log("Generated real CloudEvent messages using production classes");
    console.log(
      "specversion field check:",
      agreementCreatedMessage.specversion
        ? "lowercase (will fail)"
        : "uppercase (will pass)",
    );

    // HTTP server required by PACT v15 - serves the REAL generated CloudEvent messages
    const { createServer } = await import("http");
    mockServer = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString();
      });
      req.on("end", () => {
        try {
          const requestData = JSON.parse(body || "{}");
          const isCreatedMessage = requestData.description?.includes("created");

          // Serve the REAL CloudEvent messages (will show actual contract violations)
          const realMessage = isCreatedMessage
            ? agreementCreatedMessage
            : agreementWithdrawnMessage;

          console.log(
            `HTTP server: serving REAL CloudEvent - ${isCreatedMessage ? "created" : "withdrawn"}`,
          );
          console.log(
            `Real CloudEvent has specversion: ${realMessage.specversion !== undefined}`,
          );
          console.log(
            `Real CloudEvent has specVersion: ${realMessage.specVersion !== undefined}`,
          );

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
          `HTTP server started on port ${mockPort} - serving REAL CloudEvents`,
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
    it("should verify SNS messages for agreement events", async () => {
      console.log(
        "Running SNS provider verification with REAL CloudEvent implementation",
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
          console.log("Returning REAL AgreementCreatedEvent object");
          return agreementCreatedMessage; // Real CloudEvent from production class
        },
        "An agreement withdrawn message": async () => {
          console.log("Returning REAL AgreementWithdrawnEvent object");
          return agreementWithdrawnMessage; // Real CloudEvent from production class
        },
      };

      const opts = {
        provider: "fg-gas-backend-sns",
        providerBaseUrl: `http://localhost:${mockPort}`,
        messages: true, // CRITICAL: tells PACT this is message verification (put first)
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

      // This will now test REAL CloudEvent implementation against consumer contract
      return new Verifier(opts).verifyProvider();
    }, 120000);
  });
});
