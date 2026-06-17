import { describe, expect, it } from "vitest";
import { getAgreementInitialStatus } from "./agreement-definition-resolver.js";
import { AgreementVersion } from "./agreement-version.js";
import { Agreement } from "./agreement.js";

describe("AgreementVersion", () => {
  it("creates version 1 with a full Agreement snapshot", () => {
    const agreement = Agreement.fromDocument({
      _id: "agreement-id",
      agreementNumber: "PMF123456789",
      identifiers: {
        sbi: "123456789",
        frn: "frn-1",
        crn: "crn-1",
      },
      createdAt: "2026-06-01T09:00:00.000Z",
      updatedAt: "2026-06-01T09:30:00.000Z",
      items: [
        {
          agreementItemId: "item-1",
          agreementCode: "pigs-might-fly",
          clientRef: "PMF-APP-001",
        },
        {
          agreementItemId: "item-2",
          agreementCode: "pigs-might-fly",
          clientRef: "PMF-APP-002",
        },
      ],
    });

    const version = AgreementVersion.initial({
      id: "version-id",
      agreement,
      initialStatus: getAgreementInitialStatus("pigs-might-fly"),
      createdAt: "2026-06-01T10:00:00.000Z",
    });

    expect(version.toDocument()).toEqual({
      _id: "version-id",
      agreementId: "agreement-id",
      agreementNumber: "PMF123456789",
      version: 1,
      createdAt: "2026-06-01T10:00:00.000Z",
      snapshot: {
        _id: "agreement-id",
        agreementNumber: "PMF123456789",
        identifiers: {
          sbi: "123456789",
          frn: "frn-1",
          crn: "crn-1",
        },
        createdAt: "2026-06-01T09:00:00.000Z",
        updatedAt: "2026-06-01T09:30:00.000Z",
        items: [
          {
            agreementItemId: "item-1",
            agreementCode: "pigs-might-fly",
            clientRef: "PMF-APP-001",
            status: "offered",
            payment: null,
          },
          {
            agreementItemId: "item-2",
            agreementCode: "pigs-might-fly",
            clientRef: "PMF-APP-002",
            status: "offered",
            payment: null,
          },
        ],
      },
    });
  });
});
