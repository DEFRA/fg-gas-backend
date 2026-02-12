// test/contract/consumer.cw-backend.test.js
// Consumer test: fg-gas-backend consumes case status update events FROM fg-cw-backend
//
// ⚠️ CRITICAL FIELDS ⚠️
//
// Our code expects (src/grants/subscribers/case-status-updated.subscriber.js):
//   - source: "fg-cw-backend" | "CaseWorking" | "CW" (all mapped to "CW" for routing)
//   - data.caseRef: Used to find application by clientRef
//   - data.currentStatus: Must be in format "PHASE:STAGE:STATUS" (e.g., "PRE_AWARD:ASSESSMENT:WITHDRAWAL_REQUESTED")
//   - data.workflowCode: Used for validation
//
// The currentStatus is parsed in applyExternalStateChange() to extract phase, stage, and status.
// If format is wrong, parsing will fail and state won't update.
//
// Source field is used for routing in inbox.subscriber.js - wrong value means message won't be processed.
//
import { MatchersV2, MessageConsumerPact } from "@pact-foundation/pact";
import path from "path";
import { describe, expect, it } from "vitest";

const { like, uuid, iso8601DateTimeWithMillis, term } = MatchersV2;

describe("fg-gas-backend Consumer (receives messages from fg-cw-backend)", () => {
  const messagePact = new MessageConsumerPact({
    consumer: "fg-gas-backend",
    provider: "fg-cw-backend",
    dir: path.resolve(process.cwd(), "tmp/pacts"),
    logLevel: "info",
  });

  describe("CaseStatusUpdatedEvent Message", () => {
    it("should accept a case status updated event", async () => {
      await messagePact
        .expectsToReceive("a case status updated event from CW")
        .withContent({
          // CloudEvent fields
          id: uuid("12345678-1234-1234-1234-123456789012"),

          // Type is flexible - GAS doesn't check this, routes by source instead
          type: like("cloud.defra.test.fg-cw-backend.case.status.updated"),

          // Source is critical for routing - must be one of these values
          // GAS maps all to "CW" internally (see case-status-updated.subscriber.js)
          source: term({
            generate: "fg-cw-backend",
            matcher: "^(fg-cw-backend|CaseWorking|CW)$",
          }),

          specVersion: "1.0", // Exact - CloudEvents spec constant
          datacontenttype: "application/json", // Exact - constant
          time: iso8601DateTimeWithMillis("2025-02-09T12:00:00.000Z"),
          traceparent: like("00-trace-id"), // Used for distributed tracing

          // Data fields - explicit about exact vs flexible matching
          data: {
            // CRITICAL: caseRef maps to application.clientRef for lookup
            // If wrong or missing, application won't be found
            caseRef: like("CASE-REF-001"),

            // CRITICAL: workflowCode used for validation
            workflowCode: like("frps-private-beta"),

            // CRITICAL: currentStatus must be in format "PHASE:STAGE:STATUS"
            // GAS parses this to extract phase, stage, status components
            // Wrong format will cause parsing failure
            currentStatus: term({
              generate: "PRE_AWARD:ASSESSMENT:WITHDRAWAL_REQUESTED",
              matcher: "^[A-Z_]+:[A-Z_]+:[A-Z_]+$",
            }),

            // Optional: previousStatus is sent by CW but not used by GAS
            previousStatus: term({
              generate: "PRE_AWARD:ASSESSMENT:IN_REVIEW",
              matcher: "^[A-Z_]+:[A-Z_]+:[A-Z_]+$",
            }),
          },
        })
        .withMetadata({
          contentType: "application/json",
        })
        .verify(async (message) => {
          const cloudEvent = message.contents;

          // Only check meaningful invariants
          expect(cloudEvent.data.caseRef).toBeDefined();
          expect(cloudEvent.data.workflowCode).toBeDefined();
          expect(cloudEvent.data.currentStatus).toMatch(
            /^[A-Z_]+:[A-Z_]+:[A-Z_]+$/,
          );
        });
    });
  });
});
