import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  findByClientRefCodeAndSbi,
  findLatestVersionByAgreementNumber,
} from "../repositories/agreement.repository.js";
import { resolveCurrentAgreementByIdentity } from "./resolve-current-agreement.use-case.js";

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

const agreement = {
  agreementNumber: "PMF823153883",
  code: request.code,
  identifiers: { sbi: request.sbi },
  items: [item],
};

const version = {
  version: 2,
  snapshot: structuredClone(agreement),
};

describe("resolveCurrentAgreementByIdentity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findByClientRefCodeAndSbi.mockResolvedValue(agreement);
    findLatestVersionByAgreementNumber.mockResolvedValue(version);
  });

  it("returns the latest version, immutable identity and matching snapshot item", async () => {
    await expect(resolveCurrentAgreementByIdentity(request)).resolves.toEqual({
      identity: {
        agreementNumber: "PMF823153883",
        ...request,
      },
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
    ["root code", { ...agreement, code: "wrong-code" }],
    ["root SBI", { ...agreement, identifiers: { sbi: "999999999" } }],
    ["root item", { ...agreement, items: [] }],
  ])(
    "returns the same non-disclosing 404 for an inconsistent %s",
    async (_name, value) => {
      findByClientRefCodeAndSbi.mockResolvedValue(value);

      await expect(
        resolveCurrentAgreementByIdentity(request),
      ).rejects.toMatchObject({
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

    await expect(
      resolveCurrentAgreementByIdentity(request),
    ).rejects.toMatchObject({
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
      snapshot,
    });

    await expect(
      resolveCurrentAgreementByIdentity(request),
    ).rejects.toMatchObject({
      output: { statusCode: 500 },
    });
  });
});
