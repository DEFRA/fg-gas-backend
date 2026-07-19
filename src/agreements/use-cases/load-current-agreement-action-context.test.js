import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InvalidAgreementTransitionError } from "../models/invalid-agreement-transition.error.js";
import { loadCurrentAgreementActionContext } from "./load-current-agreement-action-context.js";
import { loadCurrentAgreementContextByItem } from "./load-current-agreement-context.js";

vi.mock("./load-current-agreement-context.js");

const request = {
  actionName: "accept",
  agreementNumber: "PMF823153883",
  agreementItemId: "29b829c4-4e38-405c-9f00-427ee94120a5",
};

const action = { preparationPage: "accept" };
const currentAgreement = {
  state: "offered",
};
const agreementDefinition = { resolveAction: vi.fn() };

describe("loadCurrentAgreementActionContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadCurrentAgreementContextByItem.mockResolvedValue({
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

    expect(loadCurrentAgreementContextByItem).toHaveBeenCalledWith({
      agreementNumber: request.agreementNumber,
      agreementItemId: request.agreementItemId,
    });
    expect(agreementDefinition.resolveAction).toHaveBeenCalledWith({
      state: "offered",
      action: "accept",
    });
  });

  it("resolves an action for the Agreement Item inside the active transaction", async () => {
    const session = { id: "session" };
    const itemRequest = {
      ...request,
      session,
    };

    await expect(
      loadCurrentAgreementActionContext(itemRequest),
    ).resolves.toEqual({ action, currentAgreement, agreementDefinition });
    expect(loadCurrentAgreementContextByItem).toHaveBeenCalledWith({
      agreementNumber: request.agreementNumber,
      agreementItemId: request.agreementItemId,
      session,
    });
  });

  it("preserves Agreement lookup failures", async () => {
    const error = Boom.notFound("Agreement not found");
    loadCurrentAgreementContextByItem.mockRejectedValue(error);

    await expect(loadCurrentAgreementActionContext(request)).rejects.toBe(
      error,
    );

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
