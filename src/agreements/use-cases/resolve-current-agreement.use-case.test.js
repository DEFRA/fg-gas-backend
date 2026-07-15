import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgreementReference } from "../models/agreement-reference.js";
import { AgreementVersion } from "../models/agreement-version.js";
import { Agreement } from "../models/agreement.js";
import {
  findByClientRefCodeAndSbi,
  findLatestVersionByAgreementNumber,
} from "../repositories/agreement.repository.js";
import { resolveCurrentAgreement } from "./resolve-current-agreement.use-case.js";

vi.mock("../repositories/agreement.repository.js");

const request = {
  code: "pigs-might-fly",
  clientRef: "xnp-rr3-nfa",
  sbi: "300000069",
};

const item = {
  agreementCode: request.code,
  clientRef: request.clientRef,
  configVersion: "0.0.1",
  status: "accepted",
};

const agreement = new Agreement({
  agreementNumber: "PMF823153883",
  code: request.code,
  identifiers: { sbi: request.sbi },
  items: [item],
});

const reference = new AgreementReference({
  agreementNumber: agreement.agreementNumber,
  ...request,
});

const version = new AgreementVersion({
  agreementNumber: agreement.agreementNumber,
  version: 2,
  snapshot: structuredClone(agreement),
});

describe("resolveCurrentAgreement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findByClientRefCodeAndSbi.mockResolvedValue(agreement);
    findLatestVersionByAgreementNumber.mockResolvedValue(version);
  });

  it("returns the latest version, immutable reference and matching snapshot item", async () => {
    await expect(resolveCurrentAgreement(request)).resolves.toEqual({
      reference,
      version,
      item,
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

      await expect(resolveCurrentAgreement(request)).rejects.toMatchObject({
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

    await expect(resolveCurrentAgreement(request)).rejects.toMatchObject({
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

    await expect(resolveCurrentAgreement(request)).rejects.toMatchObject({
      output: { statusCode: 500 },
    });
  });
});
