import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  findAgreementByNumber,
  findAgreementBySourceIdentity,
} from "../repositories/agreement.repository.js";
import {
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
});
