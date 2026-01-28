// test/contract/consumer.agreements-api.test.js
// Consumer test: fg-gas-backend consumes agreement events FROM farming-grants-agreements-api
//
// ⚠️ CRITICAL ASSUMPTION: data.status values ⚠️
//
// Our code expects (src/grants/use-cases/handle-agreement-status-change.use-case.js):
//   if (status === AgreementServiceStatus.Accepted)  // "accepted" (lowercase)
//   if (status === AgreementServiceStatus.Withdrawn) // "withdrawn" (lowercase)
//
// But agreements-api provider tests showed workflow codes like "PRE_AWARD:APPLICATION:WITHDRAWAL_REQUESTED"
// If they send workflow codes instead of normalized values, this contract will FAIL
// → We'll add transformation logic in GAS to map workflow codes to normalized values
//
// Event type: Flexible regex accepts known variants seen in their tests
// - namespace: "farming-grants-agreements-api" or "fg-gas-backend"
// - suffix: "accepted"/"created" or "withdrawn"/"withdraw"
//
// Source: Locked to "farming-grants-agreements-api" (what our code checks for routing)
//
import { Matchers, MessageConsumerPact } from "@pact-foundation/pact";
import path from "path";
import { describe, expect, it } from "vitest";

const { like, uuid, iso8601DateTimeWithMillis, term } = Matchers;

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
          // CloudEvent fields
          id: uuid("12345678-1234-1234-1234-123456789012"),

          // Flexible for namespace variants seen in their tests
          // But strict on "accepted" suffix - don't accept "created" (different semantic)
          type: term({
            generate:
              "cloud.defra.test.farming-grants-agreements-api.agreement.accepted",
            matcher:
              "^cloud\\.defra\\.(test|local|prod)\\.(farming-grants-agreements-api|fg-gas-backend)\\.agreement\\.accepted$",
          }),

          // Lock to known agreement service source
          source: term({
            generate: "farming-grants-agreements-api",
            matcher: "^farming-grants-agreements-api$",
          }),
          specVersion: "1.0", // Exact - CloudEvents spec constant
          datacontenttype: "application/json", // Exact - constant
          time: iso8601DateTimeWithMillis("2025-08-19T09:36:45.131Z"),

          // Data fields - explicit about exact vs flexible matching
          data: {
            // CRITICAL: status must be exactly "accepted" (not type-matched)
            // Our code: if (status === AgreementServiceStatus.Accepted) where Accepted = "accepted"
            // If they send workflow codes like "PRE_AWARD:APPLICATION:WITHDRAWAL_REQUESTED", this FAILS
            status: "accepted", // exact match (no wrapper = exact)

            // Flexible type matching for identifiers (any string value)
            clientRef: like("client-ref-002"),
            code: like("frps-private-beta"),
            agreementNumber: like("SFI987654321"),

            // date must be ISO8601 format
            date: iso8601DateTimeWithMillis("2025-08-19T09:36:45.131Z"),
          },
        })
        .withMetadata({
          contentType: "application/json",
        })
        .verify(async (message) => {
          const cloudEvent = message.contents;

          // Only check meaningful invariants (withContent already enforces structure)
          expect(cloudEvent.data.status).toBe("accepted");
          expect(cloudEvent.data.date).toBeDefined();
        });
    });
  });

  describe("Agreement Withdrawn Message", () => {
    it("should accept an agreement withdrawn message", async () => {
      await messagePact
        .expectsToReceive("an agreement withdrawn message")
        .withContent({
          // CloudEvent fields
          id: uuid("87654321-4321-4321-4321-210987654321"),

          // Flexible for known variants:
          // - namespace: both possibilities seen in their tests
          // - suffix: "withdrawn" or "withdraw" (they might use either)
          type: term({
            generate:
              "cloud.defra.test.farming-grants-agreements-api.agreement.withdrawn",
            matcher:
              "^cloud\\.defra\\.(test|local|prod)\\.(farming-grants-agreements-api|fg-gas-backend)\\.agreement\\.(withdrawn|withdraw)$",
          }),

          // Lock to known agreement service source
          source: term({
            generate: "farming-grants-agreements-api",
            matcher: "^farming-grants-agreements-api$",
          }),
          specVersion: "1.0", // Exact
          datacontenttype: "application/json", // Exact
          time: iso8601DateTimeWithMillis("2025-08-19T09:36:45.131Z"),

          // Data fields - explicit about exact vs flexible matching
          data: {
            // CRITICAL: status must be exactly "withdrawn" (not type-matched)
            status: "withdrawn", // exact match (no wrapper = exact)

            // Flexible type matching for identifiers
            clientRef: like("client-ref-003"),
            code: like("frps-private-beta"),
            agreementNumber: like("SFI123456789"),
          },
        })
        .withMetadata({
          contentType: "application/json",
        })
        .verify(async (message) => {
          const cloudEvent = message.contents;

          // Only check meaningful invariants
          expect(cloudEvent.data.status).toBe("withdrawn");
        });
    });
  });
});
