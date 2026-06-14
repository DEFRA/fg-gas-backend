import { describe, expect, it } from "vitest";
import {
  getAgreementCreation,
  getAgreementInitialVersion,
} from "./agreement-definition-resolver.js";
import { Agreement } from "./agreement.js";

describe("Agreement", () => {
  it("creates an Agreement wrapper with one Agreement item from the create command payload", () => {
    const answers = {
      canPigsFly: true,
      nested: { value: "preserve me" },
    };

    const agreement = Agreement.createFromCommand({
      command: {
        clientRef: "PMF-APP-001",
        code: "pigs-might-fly",
        identifiers: {
          sbi: "123456789",
          frn: "frn-1",
          crn: "crn-1",
        },
        metadata: {
          defraId: "defra-id-1",
          submittedAt: "2026-05-01T09:00:00.000Z",
        },
        answers,
      },
      definition: getAgreementCreation("pigs-might-fly"),
      now: "2026-06-01T10:00:00.000Z",
      agreementId: "agreement-id",
      agreementNumber: "PMF123456789",
      agreementItemId: "agreement-item-id",
    });
    const item = agreement.findItemForCommand({
      command: {
        clientRef: "PMF-APP-001",
      },
      definition: getAgreementCreation("pigs-might-fly"),
    });

    expect(agreement.toDocument()).toEqual({
      _id: "agreement-id",
      agreementNumber: "PMF123456789",
      sbi: "123456789",
      createdAt: "2026-06-01T10:00:00.000Z",
      updatedAt: "2026-06-01T10:00:00.000Z",
      items: [item.toDocument()],
    });
    expect(agreement.toDocument()).not.toHaveProperty("item");
    expect(agreement.toDocument()).not.toHaveProperty("currentVersionId");
    expect(item.toDocument()).not.toHaveProperty("agreementNumber");
  });

  it("creates version 1 for the current Agreement snapshot", () => {
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

    const version = agreement.createInitialVersion({
      versionId: "version-id",
      initialVersion: getAgreementInitialVersion("pigs-might-fly"),
      createdAt: "2026-06-01T10:00:00.000Z",
    });

    expect(version.toDocument()).toMatchObject({
      _id: "version-id",
      agreementId: "agreement-id",
      agreementNumber: "PMF123456789",
      sbi: "123456789",
      version: 1,
      change: {
        type: "created",
        changedBy: "system",
        fromStatus: null,
      },
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
            payment: null,
          },
        ],
      },
    });
  });
});
