// test/contract/consumer.agreements-api.test.js
// Consumer test: fg-gas-backend consumes agreement status events FROM farming-grants-agreements-api
//
// What our code reads (from src/grants/subscribers and use-cases):
// - CloudEvent fields: id, type, source, specversion, datacontenttype, traceparent (optional)
// - data.status (to route: "Accepted" | "Withdrawn")
// - data.clientRef (to find application)
// - data.code (to find grant)
// - data.agreementNumber (used by accept/withdraw use cases)
// - data.date (only for Accepted status, used by acceptAgreementUseCase)
//
import { MessageConsumerPact } from "@pact-foundation/pact";
import path from "path";
import { describe, expect, it } from "vitest";

describe("fg-gas-backend Consumer (receives messages from farming-grants-agreements-api)", () => {
  const messagePact = new MessageConsumerPact({
    consumer: "fg-gas-backend",
    provider: "farming-grants-agreements-api",
    dir: path.resolve(process.cwd(), "tmp/pacts"),
    logLevel: "info",
  });

  describe("Agreement Accepted Message", () => {
    it("should accept an agreement accepted message", async () => {
      await messagePact
        .expectsToReceive("an agreement accepted message")
        .withContent({
          // CloudEvent fields we use
          id: "12345678-1234-1234-1234-123456789012",
          type: "cloud.defra.test.farming-grants-agreements-api.agreement.status.update",
          source: "farming-grants-agreements-api",
          specversion: "1.0",
          datacontenttype: "application/json",

          // Data fields our code reads
          data: {
            status: "Accepted", // Used by handleAgreementStatusChangeUseCase
            clientRef: "client-ref-002", // Used to find application
            code: "frps-private-beta", // Used to find grant
            agreementNumber: "SFI987654321", // Used by acceptAgreementUseCase
            date: "2025-08-19T09:36:45.131Z", // Used by acceptAgreementUseCase
          },
        })
        .withMetadata({
          contentType: "application/json",
        })
        .verify(async (message) => {
          const cloudEvent = message.contents;

          // Verify CloudEvent structure
          expect(cloudEvent.id).toBeDefined();
          expect(cloudEvent.type).toBeDefined();
          expect(cloudEvent.source).toBeDefined();
          expect(cloudEvent.specversion).toBe("1.0");
          expect(cloudEvent.datacontenttype).toBe("application/json");

          // Verify data fields our code uses
          expect(cloudEvent.data.status).toBe("Accepted");
          expect(cloudEvent.data.clientRef).toBeDefined();
          expect(cloudEvent.data.code).toBeDefined();
          expect(cloudEvent.data.agreementNumber).toBeDefined();
          expect(cloudEvent.data.date).toBeDefined();
        });
    });
  });

  describe("Agreement Withdrawn Message", () => {
    it("should accept an agreement withdrawn message", async () => {
      await messagePact
        .expectsToReceive("an agreement withdrawn message")
        .withContent({
          // CloudEvent fields we use
          id: "87654321-4321-4321-4321-210987654321",
          type: "cloud.defra.test.farming-grants-agreements-api.agreement.status.update",
          source: "farming-grants-agreements-api",
          specversion: "1.0",
          datacontenttype: "application/json",

          // Data fields our code reads
          data: {
            status: "Withdrawn", // Used by handleAgreementStatusChangeUseCase
            clientRef: "client-ref-003", // Used to find application
            code: "frps-private-beta", // Used to find grant
            agreementNumber: "SFI123456789", // Used by withdrawAgreementUseCase
          },
        })
        .withMetadata({
          contentType: "application/json",
        })
        .verify(async (message) => {
          const cloudEvent = message.contents;

          // Verify CloudEvent structure
          expect(cloudEvent.id).toBeDefined();
          expect(cloudEvent.type).toBeDefined();
          expect(cloudEvent.source).toBeDefined();
          expect(cloudEvent.specversion).toBe("1.0");
          expect(cloudEvent.datacontenttype).toBe("application/json");

          // Verify data fields our code uses
          expect(cloudEvent.data.status).toBe("Withdrawn");
          expect(cloudEvent.data.clientRef).toBeDefined();
          expect(cloudEvent.data.code).toBeDefined();
          expect(cloudEvent.data.agreementNumber).toBeDefined();
        });
    });
  });
});
