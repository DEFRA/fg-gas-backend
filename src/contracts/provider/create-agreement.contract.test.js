import { MessageProviderPact } from "@pact-foundation/pact";
import { describe, expect, it, vi } from "vitest";
import { publish } from "../../common/sns-client.js";
import { Application } from "../../grants/models/application.js";
import { publishCreateAgreementCommand } from "../../grants/publishers/application-event.publisher.js";

vi.mock("../../common/sns-client.js");

// Reason: Pact consumer tests need to be published from farming-grants-agreements-api first
// Also requires PACT_BROKER_USERNAME and PACT_BROKER_PASSWORD environment variables
describe.skip("sending create agreement command via SNS", () => {
  const messagePact = new MessageProviderPact({
    provider: "fg-gas-backend",
    consumer: "farming-grants-agreements-api",
    pactBrokerUrl:
      process.env.PACT_BROKER_URL ??
      "https://ffc-pact-broker.azure.defra.cloud",
    consumerVersionSelectors: [{ latest: true }],
    pactBrokerUsername: process.env.PACT_BROKER_USERNAME,
    pactBrokerPassword: process.env.PACT_BROKER_PASSWORD,
    publishVerificationResult: true,
    providerVersion: process.env.SERVICE_VERSION ?? "1.0.0",
    messageProviders: {
      "agreement created event": async () => {
        let message;
        try {
          publish.mockResolvedValue();

          const application = Application.new({
            clientRef: "ref-1234",
            code: "frps-private-beta",
            submittedAt: "2023-10-01T11:00:00Z",
            identifiers: {
              sbi: "106284736",
              frn: "1234567890",
              crn: "1234567890",
              defraId: "1234567890",
            },
            answers: {
              scheme: "SFI",
              year: 2025,
              hasCheckedLandIsUpToDate: true,
              actionApplications: [
                {
                  parcelId: "9238",
                  sheetId: "SX0679",
                  code: "CSAM1",
                  appliedFor: {
                    unit: "ha",
                    quantity: 20.23,
                  },
                },
              ],
            },
          });

          await publishCreateAgreementCommand(application);

          message = publish.mock.calls[0][1];

          // Normalize dynamic fields for contract matching
          message.id = "12-34-56-78-90";
          message.time = "2025-10-06T16:41:59.497Z";
          message.traceparent = "00-mock-trace-id-mock-span-id-00";
        } catch (err) {
          message = "Publish event was not called, check above for errors";
        }
        return message;
      },
    },
  });

  it("should validate the message structure", async () => {
    const verify = await messagePact.verify();

    expect(verify).toBeTruthy();

    return verify;
  });
});
