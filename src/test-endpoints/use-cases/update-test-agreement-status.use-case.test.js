import Boom from "@hapi/boom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleUpdateAgreementStatusCommandUseCase } from "../../agreements/use-cases/handle-update-agreement-status-command.use-case.js";
import { loadCurrentAgreementByNumber } from "../../agreements/use-cases/load-current-agreement.js";
import { config } from "../../common/config.js";
import { internalCommandTypes } from "../../common/internal-command-types.js";
import { updateTestAgreementStatusUseCase } from "./update-test-agreement-status.use-case.js";

vi.mock(
  "../../agreements/use-cases/handle-update-agreement-status-command.use-case.js",
);
vi.mock("../../agreements/use-cases/load-current-agreement.js");

const agreementNumber = "PMF823153889";
const agreement = {
  agreementNumber,
  code: "pigs-might-fly",
  clientRef: "pmf-test-client",
  state: "offered",
};

describe("updateTestAgreementStatusUseCase", () => {
  const originalCodes = [...config.managedAgreementGrantCodes];

  beforeEach(() => {
    config.managedAgreementGrantCodes.splice(
      0,
      config.managedAgreementGrantCodes.length,
      "pigs-might-fly",
    );
    loadCurrentAgreementByNumber.mockResolvedValue(agreement);
  });

  afterEach(() => {
    config.managedAgreementGrantCodes.splice(
      0,
      config.managedAgreementGrantCodes.length,
      ...originalCodes,
    );
    vi.resetAllMocks();
  });

  it("dispatches an agreement.status.update command and returns the persisted Agreement", async () => {
    const updated = { ...agreement, state: "withdrawn", version: 2 };
    // The command handler returns a redirect location, not the Agreement, so
    // the use case re-reads the current Agreement for the response.
    loadCurrentAgreementByNumber
      .mockResolvedValueOnce(agreement)
      .mockResolvedValueOnce(updated);
    handleUpdateAgreementStatusCommandUseCase.mockResolvedValue({
      location: "/agreements/current",
    });

    const result = await updateTestAgreementStatusUseCase({
      agreementNumber,
      status: "withdrawn",
    });

    expect(result).toBe(updated);
    expect(handleUpdateAgreementStatusCommandUseCase).toHaveBeenCalledWith({
      id: expect.any(String),
      type: internalCommandTypes.AGREEMENT_STATUS_UPDATE,
      data: {
        agreementNumber,
        clientRef: agreement.clientRef,
        code: agreement.code,
        status: "withdrawn",
      },
    });
  });

  it("propagates the not found error for an unknown Agreement", async () => {
    loadCurrentAgreementByNumber.mockRejectedValue(
      Boom.notFound("Agreement not found"),
    );

    await expect(
      updateTestAgreementStatusUseCase({
        agreementNumber,
        status: "withdrawn",
      }),
    ).rejects.toMatchObject({ output: { statusCode: 404 } });
    expect(handleUpdateAgreementStatusCommandUseCase).not.toHaveBeenCalled();
  });

  it("rejects an Agreement whose grant code GAS does not manage", async () => {
    loadCurrentAgreementByNumber.mockResolvedValue({
      ...agreement,
      code: "not-managed",
    });

    await expect(
      updateTestAgreementStatusUseCase({
        agreementNumber,
        status: "withdrawn",
      }),
    ).rejects.toMatchObject({ output: { statusCode: 400 } });
    expect(handleUpdateAgreementStatusCommandUseCase).not.toHaveBeenCalled();
  });

  // The queue-facing use-case swallows an illegal transition and returns
  // undefined, which must not surface as a silent 200.
  it("reports a rejected transition as a conflict naming the current state", async () => {
    handleUpdateAgreementStatusCommandUseCase.mockResolvedValue(undefined);

    await expect(
      updateTestAgreementStatusUseCase({
        agreementNumber,
        status: "terminated",
      }),
    ).rejects.toMatchObject({
      output: { statusCode: 409 },
      data: {
        agreementNumber,
        currentState: "offered",
        requestedStatus: "terminated",
      },
    });
  });
});
