import { beforeEach, describe, expect, it, vi } from "vitest";
import { withTransaction } from "../../common/with-transaction.js";
import { agreementCommandRoutes } from "../models/agreement-definition.js";
import { processAgreementCommandUseCase } from "./process-agreement-command.use-case.js";
import { processCreateAgreementCommandUseCase } from "./process-create-agreement-command.use-case.js";

vi.mock("../../common/with-transaction.js", () => ({
  withTransaction: vi.fn((runInTransaction) => runInTransaction("session")),
}));
vi.mock("./process-create-agreement-command.use-case.js");

describe("process agreement command use case", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("can process agreement commands", () => {
    expect(
      processAgreementCommandUseCase.canProcess({
        type: "cloud.defra.local.fg-gas-backend.agreement.create",
      }),
    ).toBe(true);
  });

  it("does not process non-agreement commands", () => {
    expect(
      processAgreementCommandUseCase.canProcess({
        type: "cloud.defra.local.fg-gas-backend.application.status.updated",
      }),
    ).toBe(false);
  });

  it("does not process GPS create payment events as agreement commands", () => {
    expect(
      processAgreementCommandUseCase.canProcess({
        type: "io.onsite.agreement.create-payment",
      }),
    ).toBe(false);
  });

  it("does not process payment result events as agreement commands", () => {
    expect(
      processAgreementCommandUseCase.canProcess({
        type: "cloud.defra.local.fg-gas-backend.agreement.payment.succeeded",
      }),
    ).toBe(false);
    expect(
      processAgreementCommandUseCase.canProcess({
        type: "cloud.defra.local.fg-gas-backend.agreement.payment.failed",
      }),
    ).toBe(false);
  });

  it("processes config-driven create commands internally inside a transaction", async () => {
    const command = {
      type: "cloud.defra.local.fg-gas-backend.agreement.create",
      data: {
        code: "pigs-might-fly",
      },
    };

    const route = await processAgreementCommandUseCase.process(command);

    expect(route).toBe(agreementCommandRoutes.INTERNAL);
    expect(withTransaction).toHaveBeenCalledWith(expect.any(Function));
    expect(processCreateAgreementCommandUseCase).toHaveBeenCalledWith(
      command,
      "session",
    );
  });

  it("routes legacy create commands to the legacy path", async () => {
    const route = await processAgreementCommandUseCase.process({
      type: "cloud.defra.local.fg-gas-backend.agreement.create",
      data: {
        code: "frps-beta",
      },
    });

    expect(route).toBe(agreementCommandRoutes.LEGACY);
    expect(withTransaction).not.toHaveBeenCalled();
    expect(processCreateAgreementCommandUseCase).not.toHaveBeenCalled();
  });

  it("routes PMF payment create commands to the legacy path", async () => {
    const command = {
      type: "cloud.defra.local.fg-gas-backend.agreement.payment.create",
      data: {
        code: "pigs-might-fly",
        agreementId: "agreement-id",
        agreementItemId: "agreement-item-id",
        acceptanceVersionId: "version-2",
      },
    };

    const route = await processAgreementCommandUseCase.process(command);

    expect(route).toBe(agreementCommandRoutes.LEGACY);
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it("routes unknown agreement commands to the legacy path", async () => {
    const route = await processAgreementCommandUseCase.process({
      type: "cloud.defra.local.fg-gas-backend.agreement.cancel",
      data: {
        code: "pigs-might-fly",
      },
    });

    expect(route).toBe(agreementCommandRoutes.LEGACY);
    expect(withTransaction).not.toHaveBeenCalled();
    expect(processCreateAgreementCommandUseCase).not.toHaveBeenCalled();
  });
});
