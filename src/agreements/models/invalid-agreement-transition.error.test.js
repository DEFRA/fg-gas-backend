import { describe, expect, it } from "vitest";
import { InvalidAgreementTransitionError } from "./invalid-agreement-transition.error.js";

describe("InvalidAgreementTransitionError", () => {
  it("carries the current state, attempted action, and available actions", () => {
    const error = new InvalidAgreementTransitionError({
      from: "accepted",
      action: "accept",
      availableActions: ["terminate"],
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("InvalidAgreementTransitionError");
    expect(error.from).toBe("accepted");
    expect(error.action).toBe("accept");
    expect(error.availableActions).toEqual(["terminate"]);
    expect(error.message).toBe(
      'Cannot perform action "accept" from agreement state "accepted". Available actions: terminate.',
    );
  });

  it("reports 'none' when there are no available actions", () => {
    const error = new InvalidAgreementTransitionError({
      from: "terminated",
      action: "accept",
      availableActions: [],
    });

    expect(error.message).toBe(
      'Cannot perform action "accept" from agreement state "terminated". Available actions: none.',
    );
  });
});
