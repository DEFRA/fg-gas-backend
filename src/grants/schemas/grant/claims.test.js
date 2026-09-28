import { describe, expect, it } from "vitest";
import { claims } from "./claims.js";

const position = {
  phase: "PRE_AWARD",
  stage: "ASSESSMENT",
  status: "APPLICATION_RECEIVED",
};

const definition = (overrides = {}) => ({
  onClaimApproval: {
    currentPosition: position,
    targetPosition: {
      phase: "PRE_AWARD",
      stage: "ASSESSMENT",
      status: "AWARD_READY",
    },
    ...overrides,
  },
});

const validate = (value) => claims.validate(value);

describe("claims", () => {
  it("accepts a fully specified onClaimApproval block", () => {
    const { error } = validate(definition());

    expect(error).toBeUndefined();
  });

  it("accepts an empty claims object", () => {
    const { error } = validate({});

    expect(error).toBeUndefined();
  });

  it.each(["phase", "stage", "status"])(
    "rejects currentPosition missing %s",
    (part) => {
      const currentPosition = { ...position };
      delete currentPosition[part];

      const { error } = validate(definition({ currentPosition }));

      expect(error?.message).toContain(part);
    },
  );

  it.each(["phase", "stage", "status"])(
    "rejects targetPosition missing %s",
    (part) => {
      const targetPosition = { ...position };
      delete targetPosition[part];

      const { error } = validate(definition({ targetPosition }));

      expect(error?.message).toContain(part);
    },
  );

  it.each([
    ["currentPosition", "phase"],
    ["currentPosition", "stage"],
    ["currentPosition", "status"],
    ["targetPosition", "phase"],
    ["targetPosition", "stage"],
    ["targetPosition", "status"],
  ])("rejects an empty %s.%s", (label, part) => {
    const incompletePosition = { ...position, [part]: "" };
    const { error } = validate(definition({ [label]: incompletePosition }));

    expect(error?.message).toContain("is not allowed to be empty");
  });

  it("rejects a phase-only currentPosition", () => {
    const { error } = validate(
      definition({ currentPosition: { phase: "PRE_AWARD" } }),
    );

    expect(error?.message).toContain("stage");
  });

  it.each([
    ["claims", { unexpected: true }],
    ["onClaimApproval", definition({ unexpected: true })],
    [
      "ClaimPosition",
      definition({ currentPosition: { ...position, unexpected: true } }),
    ],
  ])("rejects unknown keys in %s", (_label, value) => {
    const { error } = validate(value);

    expect(error?.message).toContain("is not allowed");
  });
});
