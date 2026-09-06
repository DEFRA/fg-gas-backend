import { describe, expect, it, vi } from "vitest";
import { InvalidAgreementTransitionError } from "../models/invalid-agreement-transition.error.js";
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
        agreement,
        agreementNumber: "PMF123",
        actionName: "accept",
      }),
    ).resolves.toEqual({ agreement, agreementDefinition, action });
    expect(loadCurrentAgreementContext).toHaveBeenCalledWith({
      agreement,
      agreementNumber: "PMF123",
      session: undefined,
    });
  });

  it("returns a stale response before resolving an action", async () => {
    const agreement = { agreementNumber: "PMF123", state: "withdrawn" };
    const agreementDefinition = { resolveAction: vi.fn() };
    loadCurrentAgreementContext.mockResolvedValue({
      agreement,
      agreementDefinition,
      etag: '"PMF123:2:1.0.1"',
    });

    const error = await loadCurrentAgreementActionContext({
      agreement,
      actionName: "accept",
      ifMatch: '"PMF123:1:1.0.1"',
    }).catch((caught) => caught);

    expect(error.output.statusCode).toBe(412);
    expect(error.output.headers).toEqual({
      location: "/agreements/current",
      etag: '"PMF123:2:1.0.1"',
    });
    expect(agreementDefinition.resolveAction).not.toHaveBeenCalled();
  });

  it("keeps an invalid action on the current version as a conflict", async () => {
    const agreement = { agreementNumber: "PMF123", state: "withdrawn" };
    const agreementDefinition = {
      resolveAction: vi.fn(() => {
        throw new InvalidAgreementTransitionError({
          from: "withdrawn",
          action: "accept",
          availableActions: [],
        });
      }),
    };
    loadCurrentAgreementContext.mockResolvedValue({
      agreement,
      agreementDefinition,
      etag: '"PMF123:2:1.0.1"',
    });

    const error = await loadCurrentAgreementActionContext({
      agreement,
      actionName: "accept",
      ifMatch: '"PMF123:2:1.0.1"',
    }).catch((caught) => caught);

    expect(error.output.statusCode).toBe(409);
  });
});
