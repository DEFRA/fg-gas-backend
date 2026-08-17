import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../common/logger.js";
import { InvalidAgreementTransitionError } from "../models/invalid-agreement-transition.error.js";
import { findVersionByIdempotencyKey } from "../repositories/agreement.repository.js";
import { commitAgreementAction } from "./execute-agreement-action.use-case.js";
import { handleUpdateAgreementStatusCommandUseCase } from "./handle-update-agreement-status-command.use-case.js";
import { loadCurrentAgreementContext } from "./load-current-agreement-context.js";

vi.mock("../repositories/agreement.repository.js");
vi.mock("./execute-agreement-action.use-case.js");
vi.mock("./load-current-agreement-context.js");
vi.mock("../../common/logger.js", () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
}));

const command = {
  id: "withdrawal-command-id",
  data: {
    agreementNumber: "PMF123456789",
    code: "pigs-might-fly",
    status: "withdrawn",
  },
};

const agreement = {
  agreementNumber: command.data.agreementNumber,
  correlationId: "agreement-correlation-id",
  state: "offered",
};

describe("handleUpdateAgreementStatusCommandUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findVersionByIdempotencyKey.mockResolvedValue(null);
  });

  it("executes the configured action using the command id", async () => {
    const action = { transition: { action: "withdraw" } };
    const next = { agreement: { ...agreement, state: "withdrawn" } };
    const agreementDefinition = {
      resolveActionForStatus: vi.fn().mockReturnValue(action),
      executeAction: vi.fn().mockResolvedValue(next),
    };
    loadCurrentAgreementContext.mockResolvedValue({
      agreement,
      agreementDefinition,
    });

    await handleUpdateAgreementStatusCommandUseCase(command);

    expect(agreementDefinition.resolveActionForStatus).toHaveBeenCalledWith({
      state: "offered",
      status: "withdrawn",
    });
    expect(agreementDefinition.executeAction).toHaveBeenCalledWith({
      agreement,
      actionName: "withdraw",
      values: {},
      execution: {
        correlationId: agreement.correlationId,
        executedAt: expect.any(String),
      },
    });
    expect(commitAgreementAction).toHaveBeenCalledWith({
      actionName: "withdraw",
      current: agreement,
      idempotencyKey: command.id,
      next,
    });
  });

  it("completes a replay before resolving the terminal state", async () => {
    const completed = { snapshot: { ...agreement, state: "withdrawn" } };
    findVersionByIdempotencyKey.mockResolvedValue(completed);

    await expect(
      handleUpdateAgreementStatusCommandUseCase(command),
    ).resolves.toEqual(completed.snapshot);

    expect(loadCurrentAgreementContext).not.toHaveBeenCalled();
    expect(commitAgreementAction).not.toHaveBeenCalled();
  });

  it("acknowledges an invalid transition without writing", async () => {
    const agreementDefinition = {
      resolveActionForStatus: vi.fn(() => {
        throw new InvalidAgreementTransitionError({
          from: "accepted",
          action: "transition to withdrawn",
          availableActions: [],
        });
      }),
    };
    loadCurrentAgreementContext.mockResolvedValue({
      agreement: { ...agreement, state: "accepted" },
      agreementDefinition,
    });

    await expect(
      handleUpdateAgreementStatusCommandUseCase(command),
    ).resolves.toBeUndefined();

    expect(commitAgreementAction).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("acknowledges a lost concurrent transition without retry", async () => {
    const action = { transition: { action: "withdraw" } };
    const agreementDefinition = {
      resolveActionForStatus: vi.fn().mockReturnValue(action),
      executeAction: vi.fn().mockResolvedValue({ agreement }),
    };
    loadCurrentAgreementContext.mockResolvedValue({
      agreement,
      agreementDefinition,
    });
    commitAgreementAction.mockRejectedValue(
      Boom.preconditionFailed("Agreement version is stale"),
    );

    await expect(
      handleUpdateAgreementStatusCommandUseCase(command),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalled();
  });

  it("rethrows infrastructure failures for retry", async () => {
    const error = new Error("Mongo unavailable");
    loadCurrentAgreementContext.mockRejectedValue(error);

    await expect(
      handleUpdateAgreementStatusCommandUseCase(command),
    ).rejects.toBe(error);
  });
});
