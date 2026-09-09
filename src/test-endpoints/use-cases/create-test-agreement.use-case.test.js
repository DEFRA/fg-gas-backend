import Boom from "@hapi/boom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgreementUseCase } from "../../agreements/use-cases/create-agreement.use-case.js";
import { config } from "../../common/config.js";
import { createTestAgreementUseCase } from "./create-test-agreement.use-case.js";

vi.mock("../../agreements/use-cases/create-agreement.use-case.js");

const payload = {
  code: "pigs-might-fly",
  clientRef: "pmf-test-client",
  currentConfigVersion: "1.0.1",
  identifiers: { sbi: "300000071" },
  answers: { whitePigsCount: 5 },
  metadata: {},
};

describe("createTestAgreementUseCase", () => {
  const originalCodes = [...config.managedAgreementGrantCodes];

  beforeEach(() => {
    config.managedAgreementGrantCodes.splice(
      0,
      config.managedAgreementGrantCodes.length,
      "pigs-might-fly",
    );
  });

  afterEach(() => {
    config.managedAgreementGrantCodes.splice(
      0,
      config.managedAgreementGrantCodes.length,
      ...originalCodes,
    );
    vi.resetAllMocks();
  });

  it("creates the Agreement from the payload", async () => {
    const agreement = { agreementNumber: "PMF823153889", state: "offered" };
    createAgreementUseCase.mockResolvedValue(agreement);

    const result = await createTestAgreementUseCase(payload);

    expect(result).toBe(agreement);
    expect(createAgreementUseCase).toHaveBeenCalledWith(payload);
  });

  it("rejects a grant code that GAS does not manage", async () => {
    await expect(
      createTestAgreementUseCase({ ...payload, code: "not-managed" }),
    ).rejects.toMatchObject({
      output: { statusCode: 400 },
    });
    expect(createAgreementUseCase).not.toHaveBeenCalled();
  });

  it("reports creation mapping failures as a bad request", async () => {
    createAgreementUseCase.mockRejectedValue(
      Boom.badImplementation('Agreement Creation Mapping "$.input.answers"'),
    );

    await expect(createTestAgreementUseCase(payload)).rejects.toMatchObject({
      output: { statusCode: 400 },
    });
  });

  it("does not mask failures that are already client errors", async () => {
    createAgreementUseCase.mockRejectedValue(
      Boom.notFound("Agreement definition is unavailable"),
    );

    await expect(createTestAgreementUseCase(payload)).rejects.toMatchObject({
      output: { statusCode: 404 },
    });
  });
});
