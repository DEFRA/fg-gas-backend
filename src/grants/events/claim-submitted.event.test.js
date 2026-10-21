import { describe, expect, it } from "vitest";
import { Claim } from "../models/claim.js";
import { ClaimSubmittedEvent } from "./claim-submitted.event.js";

const savedClaim = (amount = 150000) =>
  Claim.create({
    code: "woodland",
    clientRef: "wmp-6hb-j8e",
    claimCode: "ENT_CS_CAPITAL_PA3",
    clientClaimRef: "WMP-6HB-J8E-C0001",
    createdAt: "2026-08-07T11:16:05.745Z",
    metadata: {
      clientRef: "wmp-6hb-j8e",
      grantCode: "woodland",
      sbi: "113593357",
      submittedAt: "2026-08-01T00:00:00.000Z",
      privateField: "omit",
    },
    claim: {
      entitlementId: "ent-1",
      totalClaimAmountPence: amount,
      privateAnswer: "omit",
    },
  });

describe("ClaimSubmittedEvent", () => {
  it.each([150000, 0])(
    "maps saved facts and the Mongo identity for amount %s",
    (amount) => {
      const event = new ClaimSubmittedEvent({
        claim: savedClaim(amount),
        claimId: "507f1f77bcf86cd799439011",
      });
      expect(event.data).toEqual({
        caseRef: "wmp-6hb-j8e",
        workflowCode: "woodland",
        claims: [
          {
            gasClaimId: "507f1f77bcf86cd799439011",
            clientClaimRef: "WMP-6HB-J8E-C0001",
            claimCode: "ENT_CS_CAPITAL_PA3",
            claimAmountPence: amount,
            sbi: "113593357",
            status: "SUBMITTED",
            submittedAt: "2026-08-07T11:16:05.745Z",
          },
        ],
      });
      expect(event).toMatchObject({
        type: "cloud.defra.local.fg-gas-backend.claim.submitted",
        messageGroupId: "wmp-6hb-j8e-woodland",
        source: "fg-gas-backend",
        specversion: "1.0",
        datacontenttype: "application/json",
        id: expect.any(String),
        time: expect.any(String),
      });
    },
  );
});
