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
      clientRef: "PMF-APP-001",
      configVersion: "0.0.1",
      identifiers: {
        sbi: "123456789",
        frn: "frn-1",
        crn: "crn-1",
        defraId: "defra-id-1",
      },
      createdAt: "2026-06-01T10:00:00.000Z",
    });
    expect(item.toSnapshotDocument()).toEqual({
      ...item.toDocument(),
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
    });
    expect(item.toDocument()).not.toHaveProperty("payload");
    expect(item.toDocument()).not.toHaveProperty("status");
    expect(item.toDocument()).not.toHaveProperty("payment");
  });

  it("matches on client reference", () => {
    const item = AgreementItem.fromDocument({
      clientRef: "PMF-APP-001",
    });

    expect(
      item.matches({
        clientRef: "PMF-APP-001",
      }),
    ).toBe(true);
    expect(
      item.matches({
        clientRef: "other-client-ref",
      }),
    ).toBe(false);
  });
});
