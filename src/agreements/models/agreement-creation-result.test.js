import { describe, expect, it } from "vitest";
import {
  agreementCreationOutcomes,
  alreadyCreatedAgreementResult,
  createdAgreementResult,
} from "./agreement-creation-result.js";
import { AgreementVersion } from "./agreement-version.js";
import { Agreement } from "./agreement.js";

describe("Agreement creation result", () => {
  it("describes a newly created Agreement with lifecycle publication intent", () => {
    const agreement = Agreement.fromDocument({
      _id: "agreement-id",
      agreementNumber: "PMF123456789",
      sbi: "123456789",
      items: [
        {
          agreementItemId: "agreement-item-id",
          agreementCode: "pigs-might-fly",
          clientRef: "PMF-APP-001",
        },
      ],
    });
    const item = agreement.findItemForCommand({
      command: {
        clientRef: "PMF-APP-001",
      },
      definition: {
        agreementCode: "pigs-might-fly",
      },
    });
    const version = new AgreementVersion({
      _id: "version-id",
      agreementId: "agreement-id",
      agreementNumber: "PMF123456789",
      sbi: "123456789",
      version: 1,
      createdAt: "2026-06-01T10:00:00.000Z",
      snapshot: {
        _id: "agreement-id",
        agreementNumber: "PMF123456789",
        sbi: "123456789",
        items: [
          {
            agreementItemId: "agreement-item-id",
            agreementCode: "pigs-might-fly",
            clientRef: "PMF-APP-001",
            status: "offered",
            payment: {
              agreementStartDate: "2026-07-01",
              agreementEndDate: "2027-06-30",
            },
            claimId: "claim-id",
          },
        ],
      },
    });

    const result = createdAgreementResult({ agreement, item, version });

    expect(result).toEqual({
      outcome: agreementCreationOutcomes.CREATED,
      agreement,
      agreementId: "agreement-id",
      agreementNumber: "PMF123456789",
      sbi: "123456789",
      item,
      publication: {
        lifecycleEvent: true,
      },
      version,
    });
  });

  it("describes an idempotent Agreement creation replay", () => {
    const agreement = Agreement.fromDocument({
      _id: "agreement-id",
      agreementNumber: "PMF123456789",
      sbi: "123456789",
      items: [
        {
          agreementItemId: "agreement-item-id",
          agreementCode: "pigs-might-fly",
          clientRef: "PMF-APP-001",
        },
      ],
    });
    const item = agreement.findItemForCommand({
      command: {
        clientRef: "PMF-APP-001",
      },
      definition: {
        agreementCode: "pigs-might-fly",
      },
    });

    const result = alreadyCreatedAgreementResult({ agreement, item });

    expect(result).toEqual({
      outcome: agreementCreationOutcomes.ALREADY_CREATED,
      agreement,
      agreementId: "agreement-id",
      agreementNumber: "PMF123456789",
      sbi: "123456789",
      item,
      publication: {},
    });
  });
});
