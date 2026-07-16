import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgreementVersion } from "../models/agreement-version.js";
import { Agreement } from "../models/agreement.js";
import { CurrentAgreement } from "../models/current-agreement.js";
import {
  findByClientRefCodeAndSbi,
  findLatestVersionByAgreementNumber,
} from "../repositories/agreement.repository.js";
import { loadCurrentAgreement } from "./load-current-agreement.js";

vi.mock("../repositories/agreement.repository.js");

const request = {
  code: "pigs-might-fly",
  clientRef: "xnp-rr3-nfa",
  sbi: "300000069",
};

const item = {
  agreementCode: request.code,
  clientRef: request.clientRef,
  identifiers: { sbi: request.sbi },
  configVersion: "0.0.1",
  state: "accepted",
};

const agreement = new Agreement({
  agreementNumber: "PMF823153883",
  code: request.code,
  identifiers: { sbi: request.sbi },
  items: [item],
});

const version = new AgreementVersion({
  agreementNumber: agreement.agreementNumber,
  version: 2,
  snapshot: structuredClone(agreement),
});

describe("loadCurrentAgreement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findByClientRefCodeAndSbi.mockResolvedValue(agreement);
    findLatestVersionByAgreementNumber.mockResolvedValue(version);
  });

  it("loads the Current Agreement from its latest recorded version", async () => {
    const currentAgreement = await loadCurrentAgreement(request);

    expect(currentAgreement).toBeInstanceOf(CurrentAgreement);
    expect(currentAgreement).toMatchObject({
      agreementNumber: "PMF823153883",
      code: "pigs-might-fly",
      definitionVersion: "0.0.1",
      state: "accepted",
      version,
    });
    expect(findByClientRefCodeAndSbi).toHaveBeenCalledWith(
      request.clientRef,
      request.code,
      request.sbi,
    );
    expect(findLatestVersionByAgreementNumber).toHaveBeenCalledWith(
      agreement.agreementNumber,
    );
  });

  it.each([
    ["missing Agreement", null],
    ["root code", new Agreement({ ...agreement, code: "wrong-code" })],
    [
      "root SBI",
      new Agreement({
        ...agreement,
        identifiers: { sbi: "999999999" },
      }),
    ],
    ["root item", new Agreement({ ...agreement, items: [] })],
  ])(
    "returns the same non-disclosing 404 for an inconsistent %s",
    async (_name, value) => {
      findByClientRefCodeAndSbi.mockResolvedValue(value);

      await expect(loadCurrentAgreement(request)).rejects.toMatchObject({
        output: {
          statusCode: 404,
          payload: { message: "Agreement not found" },
        },
      });
      expect(findLatestVersionByAgreementNumber).not.toHaveBeenCalled();
    },
  );

  it("returns 500 when the Agreement has no recorded version", async () => {
    findLatestVersionByAgreementNumber.mockResolvedValue(null);

    await expect(loadCurrentAgreement(request)).rejects.toMatchObject({
      output: { statusCode: 500 },
    });
  });

  it.each([
    ["missing snapshot", null],
    [
      "snapshot agreement number",
      { ...version.snapshot, agreementNumber: "PMF000000000" },
    ],
    ["snapshot code", { ...version.snapshot, code: "wrong-code" }],
    [
      "snapshot SBI",
      { ...version.snapshot, identifiers: { sbi: "999999999" } },
    ],
    ["snapshot item", { ...version.snapshot, items: undefined }],
  ])("returns 500 for an inconsistent %s", async (_name, snapshot) => {
    findLatestVersionByAgreementNumber.mockResolvedValue({
      ...version,
      snapshot: snapshot === null ? null : new Agreement(snapshot),
    });

    await expect(loadCurrentAgreement(request)).rejects.toMatchObject({
      output: { statusCode: 500 },
    });
  });
});
