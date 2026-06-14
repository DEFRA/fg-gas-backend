import { describe, expect, it } from "vitest";
import { getAgreementDefinition } from "./agreement-definition.js";
import { AgreementItem } from "./agreement-item.js";

describe("AgreementItem", () => {
  it("creates an Agreement item from the create command payload", () => {
    const answers = {
      canPigsFly: true,
      nested: { value: "preserve me" },
    };

    const item = AgreementItem.create({
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
      definition: getAgreementDefinition("pigs-might-fly"),
      now: "2026-06-01T10:00:00.000Z",
      agreementItemId: "agreement-item-id",
    });

    expect(item.toDocument()).toEqual({
      agreementItemId: "agreement-item-id",
      agreementCode: "pigs-might-fly",
      clientRef: "PMF-APP-001",
      configVersion: "0.0.1",
      identifiers: {
        frn: "frn-1",
        crn: "crn-1",
        defraId: "defra-id-1",
      },
      payload: {
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
      createdAt: "2026-06-01T10:00:00.000Z",
    });
    expect(item.toDocument()).not.toHaveProperty("status");
    expect(item.toDocument()).not.toHaveProperty("payment");
  });

  it("matches on Agreement code and client reference", () => {
    const item = AgreementItem.fromDocument({
      agreementCode: "pigs-might-fly",
      clientRef: "PMF-APP-001",
    });

    expect(
      item.matches({
        agreementCode: "pigs-might-fly",
        clientRef: "PMF-APP-001",
      }),
    ).toBe(true);
    expect(
      item.matches({
        agreementCode: "pigs-might-fly",
        clientRef: "other-client-ref",
      }),
    ).toBe(false);
  });
});
