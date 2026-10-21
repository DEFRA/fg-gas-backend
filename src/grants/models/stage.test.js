import { describe, expect, it } from "vitest";
import { Stage } from "./stage.js";

const stageOf = (statuses) =>
  new Stage(
    { code: "REVIEW", statuses },
    { phaseCode: "PRE_AWARD", isKnownProcess: () => true },
  );

describe("Stage", () => {
  it("places each status at its position", () => {
    const stage = stageOf([{ code: "RECEIVED" }, { code: "IN_REVIEW" }]);

    expect(stage.statuses.map(({ position }) => `${position}`)).toEqual([
      "PRE_AWARD:REVIEW:RECEIVED",
      "PRE_AWARD:REVIEW:IN_REVIEW",
    ]);
  });

  it("rejects a status code used twice", () => {
    expect(() => stageOf([{ code: "RECEIVED" }, { code: "RECEIVED" }])).toThrow(
      'status "PRE_AWARD:REVIEW:RECEIVED" is defined more than once',
    );
  });
});
