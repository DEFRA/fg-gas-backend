import { describe, expect, it } from "vitest";
import { namePosition } from "./position-names.js";

const PHASES = [
  {
    code: "PRE_AWARD",
    name: "Pre award",
    stages: [
      {
        code: "REVIEW",
        name: "Review",
        statuses: [{ code: "RECEIVED", name: "Received" }],
      },
    ],
  },
  { code: "POST_AWARD", name: null, stages: [] },
];

describe("namePosition", () => {
  it("names every phase in order, and the record's own stage and status", () => {
    expect(
      namePosition(PHASES, {
        phase: "PRE_AWARD",
        stage: "REVIEW",
        status: "RECEIVED",
      }),
    ).toEqual({
      phases: [
        { code: "PRE_AWARD", name: "Pre award" },
        { code: "POST_AWARD", name: null },
      ],
      stage: "Review",
      status: "Received",
    });
  });

  it.each([
    ["a phase", { phase: "GONE", stage: "REVIEW", status: "RECEIVED" }],
    ["a stage", { phase: "PRE_AWARD", stage: "GONE", status: "RECEIVED" }],
  ])(
    "names no stage or status under %s the definition lacks",
    (_, position) => {
      expect(namePosition(PHASES, position)).toMatchObject({
        stage: null,
        status: null,
      });
    },
  );

  it("names no status the stage lacks", () => {
    expect(
      namePosition(PHASES, {
        phase: "PRE_AWARD",
        stage: "REVIEW",
        status: "GONE",
      }),
    ).toMatchObject({ stage: "Review", status: null });
  });

  it("names nothing of a record with no position", () => {
    expect(
      namePosition(PHASES, { phase: null, stage: null, status: null }),
    ).toMatchObject({ stage: null, status: null });
  });
});
