import { describe, expect, it } from "vitest";
import {
  AgreementLifecycle,
  defaultAgreementLifecycle,
} from "./agreement-lifecycle.js";
import { InvalidAgreementTransitionError } from "./invalid-agreement-transition.error.js";

describe("AgreementLifecycle", () => {
  const lifecycle = new AgreementLifecycle();

  it("resolves the initial state", () => {
    expect(lifecycle.getInitialState()).toBe("offered");
  });

  it("resolves the available actions for the current state", () => {
    expect(lifecycle.getAvailableActions("offered")).toEqual([
      "accept",
      "withdraw",
      "cancel",
    ]);
  });

  it("resolves no available actions for a terminal state", () => {
    expect(lifecycle.getAvailableActions("terminated")).toEqual([]);
  });

  it("resolves the target state for a valid action", () => {
    expect(lifecycle.resolveAction("offered", "accept").transition).toEqual({
      from: "offered",
      action: "accept",
      target: "accepted",
    });
  });

  it("resolves withdraw and cancel from offered", () => {
    expect(lifecycle.resolveAction("offered", "withdraw").transition).toEqual({
      from: "offered",
      action: "withdraw",
      target: "withdrawn",
    });
    expect(lifecycle.resolveAction("offered", "cancel").transition).toEqual({
      from: "offered",
      action: "cancel",
      target: "cancelled",
    });
  });

  it("resolves terminate from accepted", () => {
    expect(lifecycle.resolveAction("accepted", "terminate").transition).toEqual(
      {
        from: "accepted",
        action: "terminate",
        target: "terminated",
      },
    );
  });

  it("rejects an invalid transition with an actionable error", () => {
    expect(() => lifecycle.resolveAction("accepted", "accept")).toThrow(
      InvalidAgreementTransitionError,
    );

    try {
      lifecycle.resolveAction("accepted", "accept");
      expect.unreachable();
    } catch (error) {
      expect(error.from).toBe("accepted");
      expect(error.action).toBe("accept");
      expect(error.availableActions).toEqual(["terminate"]);
    }
  });

  it("rejects an action from a terminal state", () => {
    expect(() => lifecycle.resolveAction("withdrawn", "accept")).toThrow(
      InvalidAgreementTransitionError,
    );
  });

  it.each(["toString", "__proto__"])(
    "rejects inherited object property %s as an unavailable action",
    (action) => {
      expect(() => lifecycle.resolveAction("offered", action)).toThrow(
        InvalidAgreementTransitionError,
      );
    },
  );

  it("uses the default lifecycle definition by default", () => {
    expect(lifecycle.definition).toBe(defaultAgreementLifecycle);
  });

  it("throws when asked for available actions on an unknown state", () => {
    expect(() => lifecycle.getAvailableActions("unknown")).toThrow(
      'Unknown agreement lifecycle state: "unknown"',
    );
  });
});
