import Boom from "@hapi/boom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleCreateAgreementCommandUseCase } from "../../agreements/use-cases/handle-create-agreement-command.use-case.js";
import { config } from "../../common/config.js";
import { internalCommandTypes } from "../../common/internal-command-types.js";
import { createTestAgreementUseCase } from "./create-test-agreement.use-case.js";

vi.mock(
  "../../agreements/use-cases/handle-create-agreement-command.use-case.js",
);

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

  it("dispatches an agreement.create command built from the payload", async () => {
    const agreement = { agreementNumber: "PMF823153889", state: "offered" };
    handleCreateAgreementCommandUseCase.mockResolvedValue(agreement);

    const result = await createTestAgreementUseCase(payload);

    expect(result).toBe(agreement);
    expect(handleCreateAgreementCommandUseCase).toHaveBeenCalledWith({
      id: expect.any(String),
      type: internalCommandTypes.AGREEMENT_CREATE,
      data: payload,
    });
  });

  it("generates a unique idempotency key for each request", async () => {
    handleCreateAgreementCommandUseCase.mockResolvedValue({});

    await createTestAgreementUseCase(payload);
    await createTestAgreementUseCase(payload);

    const [[first], [second]] =
      handleCreateAgreementCommandUseCase.mock.calls.map((call) => call);

    expect(first.id).not.toBe(second.id);
  });

  it("rejects a grant code that GAS does not manage", async () => {
    await expect(
      createTestAgreementUseCase({ ...payload, code: "not-managed" }),
    ).rejects.toMatchObject({
      output: { statusCode: 400 },
    });
    expect(handleCreateAgreementCommandUseCase).not.toHaveBeenCalled();
  });

  it("reports creation mapping failures as a bad request", async () => {
    handleCreateAgreementCommandUseCase.mockRejectedValue(
      Boom.badImplementation('Agreement Creation Mapping "$.input.answers"'),
    );

    await expect(createTestAgreementUseCase(payload)).rejects.toMatchObject({
      output: { statusCode: 400 },
    });
  });

  it("does not mask failures that are already client errors", async () => {
    handleCreateAgreementCommandUseCase.mockRejectedValue(
      Boom.notFound("Agreement definition is unavailable"),
    );

    await expect(createTestAgreementUseCase(payload)).rejects.toMatchObject({
      output: { statusCode: 404 },
    });
  });
});
