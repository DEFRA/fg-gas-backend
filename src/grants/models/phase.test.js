import { describe, expect, it } from "vitest";
import { Phase } from "./phase.js";

const questions = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
};

const compileQuestions = (schema) => {
  if (!schema.$schema) {
    throw new Error("no $schema");
  }
};

const phaseOf = (definition) =>
  new Phase(
    {
      code: "PRE_AWARD",
      stages: [{ code: "REVIEW", statuses: [{ code: "RECEIVED" }] }],
      ...definition,
    },
    { isKnownProcess: () => true, compileQuestions },
  );

describe("Phase", () => {
  it("has questions it can compile", () => {
    expect(phaseOf({ questions }).hasQuestions).toBe(true);
  });

  it.each([
    ["no questions", undefined],
    ["empty questions", {}],
  ])("accepts %s", (_label, phaseQuestions) => {
    expect(
      () =>
        new Phase(
          {
            code: "PRE_AWARD",
            stages: [{ code: "REVIEW", statuses: [{ code: "RECEIVED" }] }],
            questions: phaseQuestions,
          },
          { isKnownProcess: () => true, compileQuestions: () => {} },
        ),
    ).not.toThrow();
  });

  it("rejects questions that cannot be compiled", () => {
    expect(() => phaseOf({ questions: { type: "object" } })).toThrow(
      'phase "PRE_AWARD" questions cannot be compiled: no $schema',
    );
  });

  it("rejects a stage code used twice", () => {
    expect(() =>
      phaseOf({
        stages: [
          { code: "REVIEW", statuses: [{ code: "RECEIVED" }] },
          { code: "REVIEW", statuses: [{ code: "HELD" }] },
        ],
      }),
    ).toThrow('stage "PRE_AWARD:REVIEW" is defined more than once');
  });
});
