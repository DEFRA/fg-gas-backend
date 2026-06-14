import { beforeEach, describe, expect, it, vi } from "vitest";
import { withTransaction } from "../../common/with-transaction.js";
import {
  agreementCommandDelivery,
  agreementCommandDeliveryOutcomes,
  deliverAgreementCommand,
  deliverAgreementCommandResult,
  resolveAgreementCommandDelivery,
} from "./deliver-agreement-command.use-case.js";
import { processCreateAgreementCommandUseCase } from "./process-create-agreement-command.use-case.js";

vi.mock("../../common/with-transaction.js", () => ({
  withTransaction: vi.fn((runInTransaction) => runInTransaction("session")),
}));
vi.mock("./process-create-agreement-command.use-case.js");

describe("Agreement command delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("can deliver known Agreement command outbox events", () => {
    expect(
      agreementCommandDelivery.canDeliver({
        event: {
          type: "cloud.defra.local.fg-gas-backend.agreement.create",
        },
      }),
    ).toBe(true);
  });

  it("does not deliver non-Agreement command outbox events", () => {
    expect(
      agreementCommandDelivery.canDeliver({
        event: {
          type: "cloud.defra.local.fg-gas-backend.application.status.updated",
        },
      }),
    ).toBe(false);
  });

  it("delivers config-driven create commands internally inside a transaction", async () => {
    const command = {
      type: "cloud.defra.local.fg-gas-backend.agreement.create",
      data: {
        code: "pigs-might-fly",
      },
    };

    const result = await deliverAgreementCommand(command);

    expect(result).toBe(true);
    expect(withTransaction).toHaveBeenCalledWith(expect.any(Function));
    expect(processCreateAgreementCommandUseCase).toHaveBeenCalledWith(
      command,
      "session",
    );
  });

  it("resolves PMF create commands to the internal delivery route", () => {
    expect(
      resolveAgreementCommandDelivery({
        type: "cloud.defra.local.fg-gas-backend.agreement.create",
        data: {
          code: "pigs-might-fly",
        },
      }),
    ).toEqual({
      commandName: "create",
      delivered: false,
      outcome: agreementCommandDeliveryOutcomes.DELIVER_INTERNALLY,
      route: "internal",
    });
  });

  it("returns an internal delivery result after delivering PMF create commands", async () => {
    const command = {
      type: "cloud.defra.local.fg-gas-backend.agreement.create",
      data: {
        code: "pigs-might-fly",
      },
    };

    const result = await deliverAgreementCommandResult(command);

    expect(result).toEqual({
      commandName: "create",
      delivered: true,
      outcome: agreementCommandDeliveryOutcomes.DELIVERED_INTERNALLY,
      route: "internal",
    });
    expect(processCreateAgreementCommandUseCase).toHaveBeenCalledWith(
      command,
      "session",
    );
  });

  it("resolves unknown Agreement codes to the legacy delivery route", () => {
    expect(
      resolveAgreementCommandDelivery({
        type: "cloud.defra.local.fg-gas-backend.agreement.create",
        data: {
          code: "frps-beta",
        },
      }),
    ).toEqual({
      commandName: "create",
      delivered: false,
      outcome: agreementCommandDeliveryOutcomes.DELIVER_EXTERNALLY,
      route: "legacy",
    });
  });

  it("leaves legacy create commands for external delivery", async () => {
    const result = await deliverAgreementCommand({
      type: "cloud.defra.local.fg-gas-backend.agreement.create",
      data: {
        code: "frps-beta",
      },
    });

    expect(result).toBe(false);
    expect(withTransaction).not.toHaveBeenCalled();
    expect(processCreateAgreementCommandUseCase).not.toHaveBeenCalled();
  });

  it("leaves unknown Agreement commands for external delivery", async () => {
    const result = await deliverAgreementCommand({
      type: "cloud.defra.local.fg-gas-backend.agreement.cancel",
      data: {
        code: "pigs-might-fly",
      },
    });

    expect(result).toBe(false);
    expect(withTransaction).not.toHaveBeenCalled();
    expect(processCreateAgreementCommandUseCase).not.toHaveBeenCalled();
  });
});
