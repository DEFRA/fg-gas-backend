import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  findAgreementByNumber,
  findAgreementBySourceIdentity,
} from "../repositories/agreement.repository.js";
import {
  loadAgreementDocument,
  loadAgreementForAction,
  loadCurrentAgreement,
  loadCurrentAgreementByNumber,
} from "./load-current-agreement.js";

vi.mock("../repositories/agreement.repository.js");

const agreement = {
  agreementNumber: "PMF823153883",
  code: "pigs-might-fly",
  clientRef: "xnp-rr3-nfa",
  identifiers: { sbi: "300000069" },
};

describe("load current Agreement", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads by source identity within the SBI account", async () => {
    findAgreementBySourceIdentity.mockResolvedValue(agreement);

    await expect(
      loadCurrentAgreement({
        code: agreement.code,
        clientRef: agreement.clientRef,
        sbi: agreement.identifiers.sbi,
      }),
    ).resolves.toBe(agreement);
  });

  it("does not disclose an Agreement from another SBI account", async () => {
    findAgreementBySourceIdentity.mockResolvedValue(agreement);

    await expect(
      loadCurrentAgreement({
        code: agreement.code,
        clientRef: agreement.clientRef,
        sbi: "999999999",
      }),
    ).rejects.toMatchObject({ output: { statusCode: 404 } });
  });

  it("loads canonical access by Agreement Number", async () => {
    findAgreementByNumber.mockResolvedValue(agreement);

    await expect(
      loadCurrentAgreementByNumber({
        agreementNumber: agreement.agreementNumber,
      }),
    ).resolves.toBe(agreement);
  });

  it("loads a customer document when the grant and SBI match", async () => {
    findAgreementByNumber.mockResolvedValue(agreement);

    await expect(
      loadAgreementDocument({
        agreementNumber: agreement.agreementNumber,
        access: {
          source: "defra",
          code: agreement.code,
          sbi: agreement.identifiers.sbi,
        },
      }),
    ).resolves.toBe(agreement);
  });

  it("does not disclose a numbered document from another SBI account", async () => {
    findAgreementByNumber.mockResolvedValue(agreement);

    await expect(
      loadAgreementDocument({
        agreementNumber: agreement.agreementNumber,
        access: {
          source: "defra",
          code: agreement.code,
          sbi: "999999999",
        },
      }),
    ).rejects.toMatchObject({ output: { statusCode: 404 } });
  });

  it("allows Caseworking to read a document when the grant and SBI match", async () => {
    findAgreementByNumber.mockResolvedValue(agreement);

    await expect(
      loadAgreementDocument({
        agreementNumber: agreement.agreementNumber,
        access: {
          source: "entra",
          code: agreement.code,
          sbi: agreement.identifiers.sbi,
        },
      }),
    ).resolves.toBe(agreement);
  });

  it("does not disclose a document to Caseworking for another SBI", async () => {
    findAgreementByNumber.mockResolvedValue(agreement);

    await expect(
      loadAgreementDocument({
        agreementNumber: agreement.agreementNumber,
        access: {
          source: "entra",
          code: agreement.code,
          sbi: "999999999",
        },
      }),
    ).rejects.toMatchObject({ output: { statusCode: 404 } });
  });

  it("does not allow an unsupported document access source", async () => {
    findAgreementByNumber.mockResolvedValue(agreement);

    await expect(
      loadAgreementDocument({
        agreementNumber: agreement.agreementNumber,
        access: {
          source: "unknown",
          code: agreement.code,
          sbi: agreement.identifiers.sbi,
        },
      }),
    ).rejects.toMatchObject({ output: { statusCode: 404 } });
  });

  it("does not disclose a numbered document from another grant", async () => {
    findAgreementByNumber.mockResolvedValue(agreement);

    await expect(
      loadAgreementDocument({
        agreementNumber: agreement.agreementNumber,
        access: {
          source: "defra",
          code: "another-grant",
          sbi: agreement.identifiers.sbi,
        },
      }),
    ).rejects.toMatchObject({ output: { statusCode: 404 } });
  });

  it("allows a customer to act on their own Agreement", async () => {
    findAgreementByNumber.mockResolvedValue(agreement);

    await expect(
      loadAgreementForAction({
        agreementNumber: agreement.agreementNumber,
        access: {
          source: "defra",
          code: agreement.code,
          sbi: agreement.identifiers.sbi,
        },
      }),
    ).resolves.toBe(agreement);
  });

  it("does not allow Caseworking to invoke Agreement actions", async () => {
    findAgreementByNumber.mockResolvedValue(agreement);

    await expect(
      loadAgreementForAction({
        agreementNumber: agreement.agreementNumber,
        access: {
          source: "entra",
          code: agreement.code,
          sbi: agreement.identifiers.sbi,
        },
      }),
    ).rejects.toMatchObject({ output: { statusCode: 404 } });
  });
});
