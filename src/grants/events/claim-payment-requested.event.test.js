import { describe, expect, it } from "vitest";
import {
  CLAIM_PAYMENT_REQUESTED_EVENT_TYPE,
  ClaimPaymentRequestedEvent,
} from "./claim-payment-requested.event.js";

const request = () => ({
  code: "woodland",
  clientRef: "WDL-100001",
  clientClaimRef: "claim-2026-001",
  entitlementId: "entitlement-1",
  configVersion: "1.28.2",
  agreement: {
    agreementNumber: "WDL100000001",
    agreementVersion: 3,
    correlationId: "e069239d-a4a4-4e08-892a-31c80f0eb69f",
  },
  executedAt: "2026-09-14T13:11:01.000Z",
  claim: {
    sbi: "113593357",
    frn: "1100943757",
    totalAmountPence: 150000,
    evidence: { reference: "evidence-1" },
  },
});

describe("ClaimPaymentRequestedEvent", () => {
  it("captures the complete immutable Claim payment context", () => {
    const sourceRequest = request();
    const event = new ClaimPaymentRequestedEvent(sourceRequest);

    expect(event).toMatchObject({
      id: expect.any(String),
      type: CLAIM_PAYMENT_REQUESTED_EVENT_TYPE,
      specversion: "1.0",
      datacontenttype: "application/json",
      time: expect.any(String),
      messageGroupId: "WDL-100001",
      data: {
        requestId: "claim:woodland:WDL-100001:claim-2026-001",
        source: {
          code: "woodland",
          clientRef: "WDL-100001",
          clientClaimRef: "claim-2026-001",
          entitlementId: "entitlement-1",
        },
        agreement: sourceRequest.agreement,
        configVersion: "1.28.2",
        executedAt: "2026-09-14T13:11:01.000Z",
        snapshot: sourceRequest.claim,
      },
    });

    sourceRequest.claim.evidence.reference = "changed";
    sourceRequest.agreement.agreementVersion = 4;
    expect(event.data.snapshot.evidence.reference).toBe("evidence-1");
    expect(event.data.agreement.agreementVersion).toBe(3);
    expect(Object.isFrozen(event.data.snapshot.evidence)).toBe(true);
    expect(Object.isFrozen(event.data.agreement)).toBe(true);
  });

  it("rejects a request without a source identity or Agreement reference", () => {
    const sourceRequest = request();
    delete sourceRequest.clientClaimRef;
    delete sourceRequest.agreement.correlationId;

    expect(() => new ClaimPaymentRequestedEvent(sourceRequest)).toThrow(
      /"clientClaimRef" is required.*"agreement.correlationId" is required/,
    );
  });
});
