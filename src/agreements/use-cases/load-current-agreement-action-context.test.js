import { describe, expect, it, vi } from "vitest";
import { loadCurrentAgreementActionContext } from "./load-current-agreement-action-context.js";
import { loadCurrentAgreementContext } from "./load-current-agreement-context.js";

vi.mock("./load-current-agreement-context.js");

describe("loadCurrentAgreementActionContext", () => {
  it("resolves an action from the Agreement lifecycle state", async () => {
    const agreement = { agreementNumber: "PMF123", state: "offered" };
    const action = { transition: { target: "accepted" } };
    const agreementDefinition = {
      resolveAction: vi.fn().mockReturnValue(action),
    };
    loadCurrentAgreementContext.mockResolvedValue({
      agreement,
      agreementDefinition,
    });

    await expect(
      loadCurrentAgreementActionContext({
        agreementNumber: "PMF123",
        actionName: "accept",
      }),
    ).resolves.toEqual({ agreement, agreementDefinition, action });
    expect(loadCurrentAgreementContext).toHaveBeenCalledWith({
      agreementNumber: "PMF123",
      session: undefined,
    });
  });
});
