import { describe, expect, it } from "vitest";
import { GrantLifecycle } from "./grant-lifecycle.js";
import { Position } from "./position.js";

const questions = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
};

const phases = () => [
  {
    code: "PRE_AWARD",
    questions,
    stages: [
      {
        code: "REVIEW",
        statuses: [
          { code: "RECEIVED", validFrom: [] },
          {
            code: "IN_REVIEW",
            validFrom: [{ code: "RECEIVED", processes: [] }],
          },
        ],
      },
    ],
  },
  {
    code: "POST_AWARD",
    stages: [
      {
        code: "MONITORING",
        statuses: [
          {
            code: "ACCEPTED",
            validFrom: [{ code: "PRE_AWARD:REVIEW:IN_REVIEW", processes: [] }],
          },
        ],
      },
    ],
  },
];

const lifecycleOf = (definition) =>
  new GrantLifecycle(definition, {
    isKnownProcess: () => true,
    compileQuestions: () => {},
  });

describe("GrantLifecycle", () => {
  it("has every position in its phases", () => {
    expect(lifecycleOf(phases()).positions.map((p) => `${p}`)).toEqual([
      "PRE_AWARD:REVIEW:RECEIVED",
      "PRE_AWARD:REVIEW:IN_REVIEW",
      "POST_AWARD:MONITORING:ACCEPTED",
    ]);
  });

  describe("has", () => {
    const lifecycle = lifecycleOf(phases());

    it("has a position in its phases", () => {
      expect(
        lifecycle.has(Position.parse("POST_AWARD:MONITORING:ACCEPTED")),
      ).toBe(true);
    });

    it("does not have a position outside its phases", () => {
      expect(lifecycle.has(Position.parse("POST_AWARD:MONITORING:HELD"))).toBe(
        false,
      );
    });

    it("does not have no position", () => {
      expect(lifecycle.has(null)).toBe(false);
    });
  });

  it("accepts a validFrom status code from another phase", () => {
    const definition = phases();
    definition[1].stages[0].statuses.push({
      code: "HELD",
      validFrom: [{ code: "IN_REVIEW", processes: [] }],
    });

    expect(() => lifecycleOf(definition)).not.toThrow();
  });

  it("rejects a validFrom that names no position", () => {
    const definition = phases();
    definition[1].stages[0].statuses.push({
      code: "HELD",
      validFrom: [{ code: "MISSING", processes: [] }],
    });

    expect(() => lifecycleOf(definition)).toThrow(
      'status "POST_AWARD:MONITORING:HELD" is valid from "MISSING" which does not match any position in "phases"',
    );
  });

  it("rejects a phase code used twice", () => {
    const definition = phases();
    definition.push({ ...definition[1] });

    expect(() => lifecycleOf(definition)).toThrow(
      'phase "POST_AWARD" is defined more than once',
    );
  });

  it("rejects a first phase with no questions", () => {
    const definition = phases();
    delete definition[0].questions;

    expect(() => lifecycleOf(definition)).toThrow(
      'phase "PRE_AWARD" has no questions to validate answers against',
    );
  });
});
