import { describe, expect, it, vi } from "vitest";
import { createAgreementUseCase } from "./create-agreement.use-case.js";
import { handleCreateAgreementCommandUseCase } from "./handle-create-agreement-command.use-case.js";

vi.mock("./create-agreement.use-case.js");

describe("handleCreateAgreementCommandUseCase", () => {
  it("creates the Agreement from the command data and returns the result", async () => {
    const command = {
      id: "command-id",
      type: "agreement.create",
      data: { clientRef: "xnp-rr3-nfa", code: "pigs-might-fly" },
    };
    const agreement = { agreementNumber: "PMF823153883" };
    createAgreementUseCase.mockResolvedValue(agreement);

    await expect(handleCreateAgreementCommandUseCase(command)).resolves.toBe(
      agreement,
    );
    expect(createAgreementUseCase).toHaveBeenCalledWith(command.data);
  });
});
