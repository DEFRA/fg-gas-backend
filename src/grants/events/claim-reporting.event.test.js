import { validateReportingEvent } from "@defra/grants-reporting-publisher";
import { describe, expect, it } from "vitest";
import { config } from "../../common/config.js";
import { Claim } from "../models/claim.js";
import { createClaimSubmittedReportingPublication } from "./claim-reporting.event.js";

describe("Claim submission reporting", () => {
  it("reports the submitted Claim using its client reference, receipt time and value in pounds", () => {
    const claim = Claim.create({
      code: "woodland",
      clientRef: "application-1",
      claimCode: "ENT_CS_CAPITAL_PA3",
      clientClaimRef: "WMP-6HB-J8E-C0001",
      metadata: {
        sbi: "900000001",
        submittedAt: "2026-09-09T12:00:00.000Z",
      },
      claim: { entitlementId: "entitlement-1", totalClaimAmountPence: 150025 },
      createdAt: "2026-09-10T17:29:55.456Z",
    });

    const publication = createClaimSubmittedReportingPublication({
      claim,
      agreement: {
        agreementNumber: "WMP123456789",
        correlationId: "agreement-correlation-id",
      },
    });

    expect(publication).toEqual({
      target: config.sns.reportingEventsTopicArn,
      segregationRef: "WMP123456789",
      refs: [
        ["ref", "application-1"],
        ["application", "woodland:application-1"],
      ],
      event: {
        correlationId: "agreement-correlation-id",
        datetime: "2026-09-10T17:29:55.456Z",
        version: "1.0.0",
        application: "GAS",
        service: "grants",
        eventData: {
          eventType: "CLAIM_SUBMITTED",
          sbi: "900000001",
          agreementId: "WMP123456789",
          claimId: "WMP-6HB-J8E-C0001",
          claimCode: "ENT_CS_CAPITAL_PA3",
          claimStatus: "SUBMITTED",
          claimReceiptDate: "2026-09-10T17:29:55.456Z",
          claimValue: 1500.25,
        },
      },
    });
    expect(validateReportingEvent(publication.event).valid).toBe(true);
  });

  it("rejects a reporting event when the Claim has no SBI", () => {
    const claim = Claim.create({
      code: "woodland",
      clientRef: "application-1",
      claimCode: "ENT_CS_CAPITAL_PA3",
      clientClaimRef: "WMP-6HB-J8E-C0001",
      metadata: {},
      claim: { entitlementId: "entitlement-1", totalClaimAmountPence: 150025 },
      createdAt: "2026-09-10T17:29:55.456Z",
    });

    expect(() =>
      createClaimSubmittedReportingPublication({
        claim,
        agreement: {
          agreementNumber: "WMP123456789",
          correlationId: "agreement-correlation-id",
        },
      }),
    ).toThrow('Invalid Claim reporting event: "eventData.sbi" is required');
  });
});
