import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../common/logger.js";
import { resolvePaymentDefinition } from "../../payments/use-cases/resolve-payment-definition.js";
import { InvalidAgreementTransitionError } from "../models/invalid-agreement-transition.error.js";
import { findVersionByIdempotencyKey } from "../repositories/agreement.repository.js";
import { commitAgreementAction } from "./execute-agreement-action.use-case.js";
import { handleUpdateAgreementStatusCommandUseCase } from "./handle-update-agreement-status-command.use-case.js";
import { loadCurrentAgreementContext } from "./load-current-agreement-context.js";

vi.mock("../../payments/use-cases/resolve-payment-definition.js");
vi.mock("../repositories/agreement.repository.js");
vi.mock("./execute-agreement-action.use-case.js", async (importOriginal) => ({
  ...(await importOriginal()),
  commitAgreementAction: vi.fn(),
}));
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
  code: "pigs-might-fly",
  configVersion: "1.1.0",
  correlationId: "agreement-correlation-id",
  state: "offered",
};

const resolvedPayment = { totalAmountPence: 3800 };

describe("handleUpdateAgreementStatusCommandUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findVersionByIdempotencyKey.mockResolvedValue(null);
  });

  it("executes a non-Payment action using the command id", async () => {
    const action = { transition: { action: "withdraw" } };
    const next = {
      agreement: { ...agreement, state: "withdrawn" },
      commitOperations: [],
    };
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
    expect(resolvePaymentDefinition).not.toHaveBeenCalled();
    expect(commitAgreementAction).toHaveBeenCalledWith({
      actionName: "withdraw",
      current: agreement,
      idempotencyKey: command.id,
      next,
      resolvedPayment: null,
    });
  });

  it("resolves Payment for an acceptance commit operation", async () => {
    const acceptCommand = {
      ...command,
      id: "acceptance-command-id",
      data: { ...command.data, status: "accepted" },
    };
    const next = {
      agreement: {
        ...agreement,
        configVersion: "1.2.0",
        state: "accepted",
      },
      commitOperations: [{ type: "create-agreement-payment" }],
    };
    const agreementDefinition = {
      resolveActionForStatus: vi.fn().mockReturnValue({
        transition: { action: "accept" },
      }),
      executeAction: vi.fn().mockResolvedValue(next),
    };
    loadCurrentAgreementContext.mockResolvedValue({
      agreement,
      agreementDefinition,
    });
    resolvePaymentDefinition.mockResolvedValue(resolvedPayment);

    await handleUpdateAgreementStatusCommandUseCase(acceptCommand);

    const [{ execution }] = agreementDefinition.executeAction.mock.calls[0];
    expect(resolvePaymentDefinition).toHaveBeenCalledWith({
      code: agreement.code,
      configVersion: next.agreement.configVersion,
      context: { agreement: next.agreement, execution },
    });
    expect(commitAgreementAction).toHaveBeenCalledWith({
      actionName: "accept",
      current: agreement,
      idempotencyKey: acceptCommand.id,
      next,
      resolvedPayment,
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
      executeAction: vi.fn().mockResolvedValue({
        agreement,
        commitOperations: [],
      }),
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
