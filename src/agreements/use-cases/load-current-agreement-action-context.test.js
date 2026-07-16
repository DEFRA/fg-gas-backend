import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InvalidAgreementTransitionError } from "../models/invalid-agreement-transition.error.js";
import { loadCurrentAgreementActionContext } from "./load-current-agreement-action-context.js";
import { loadCurrentAgreementContext } from "./load-current-agreement-context.js";

vi.mock("./load-current-agreement-context.js");

const request = {
  actionName: "accept",
  agreementNumber: "PMF823153883",
  code: "pigs-might-fly",
  clientRef: "xnp-rr3-nfa",
  sbi: "300000069",
};

const action = { preparationPage: "accept" };
const currentAgreement = {
  state: "offered",
  reference: { agreementNumber: request.agreementNumber },
};
const agreementDefinition = { resolveAction: vi.fn() };

describe("loadCurrentAgreementActionContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadCurrentAgreementContext.mockResolvedValue({
      currentAgreement,
      agreementDefinition,
    });
    agreementDefinition.resolveAction.mockReturnValue(action);
  });

  it("resolves the named action from the latest Agreement state", async () => {
    await expect(loadCurrentAgreementActionContext(request)).resolves.toEqual({
      action,
      currentAgreement,
      agreementDefinition,
    });

    expect(loadCurrentAgreementContext).toHaveBeenCalledWith({
      code: request.code,
      clientRef: request.clientRef,
      sbi: request.sbi,
    });
    expect(agreementDefinition.resolveAction).toHaveBeenCalledWith({
      state: "offered",
      action: "accept",
    });
  });

  it("returns non-disclosing not found for a mismatched Agreement number", async () => {
    await expect(
      loadCurrentAgreementActionContext({
        ...request,
        agreementNumber: "PMF000000000",
      }),
    ).rejects.toMatchObject({
      isBoom: true,
      message: "Agreement not found",
      output: { statusCode: 404 },
    });

    expect(agreementDefinition.resolveAction).not.toHaveBeenCalled();
  });

  it("maps an unavailable action to conflict", async () => {
    agreementDefinition.resolveAction.mockImplementation(() => {
      throw new InvalidAgreementTransitionError({
        from: "offered",
        action: "decline",
        availableActions: ["accept"],
      });
    });

    await expect(
      loadCurrentAgreementActionContext({
        ...request,
        actionName: "decline",
      }),
    ).rejects.toMatchObject({
      isBoom: true,
      output: { statusCode: 409 },
    });
  });

  it("preserves Agreement integrity failures", async () => {
    const error = Boom.badImplementation("Invalid Agreement definition");
    agreementDefinition.resolveAction.mockImplementation(() => {
      throw error;
    });

    await expect(loadCurrentAgreementActionContext(request)).rejects.toBe(
      error,
    );
  });
});
