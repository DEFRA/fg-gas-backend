import { describe, expect, it } from "vitest";
import { ExternalStatusMap } from "./external-status-map.js";
import { GrantLifecycle } from "./grant-lifecycle.js";
import { Position } from "./position.js";

const lifecycle = {
  has: (position) =>
    ["PRE_AWARD:REVIEW:IN_REVIEW", "POST_AWARD:MONITORING:ACCEPTED"].some(
      (known) => Position.parse(known).equals(position),
    ),
};

const mapOf = (statuses) => ({
  phases: [{ code: "PRE_AWARD", stages: [{ code: "REVIEW", statuses }] }],
});

describe("ExternalStatusMap", () => {
  it("accepts mappings to positions that exist", () => {
    const map = new ExternalStatusMap(
      mapOf([
        { code: "IN_PROGRESS", source: "CW", mappedTo: "::IN_REVIEW" },
        { code: "REVIEWING", source: "CW", mappedTo: "IN_REVIEW" },
        {
          code: "accepted",
          source: "AS",
          mappedTo: "POST_AWARD:MONITORING:ACCEPTED",
        },
      ]),
    );

    expect(() => map.assertTargetsExistIn(lifecycle)).not.toThrow();
  });

  it.each([
    ["no map", undefined],
    ["no phases", {}],
    ["empty phases", { phases: [] }],
    ["an empty stage", mapOf([])],
  ])("accepts %s", (_label, externalStatusMap) => {
    expect(() =>
      new ExternalStatusMap(externalStatusMap).assertTargetsExistIn(lifecycle),
    ).not.toThrow();
  });

  it("rejects a mapping whose target is only written like a position that exists", () => {
    const lifecycleWithColons = new GrantLifecycle(
      [
        {
          code: "A",
          questions: {},
          stages: [
            { code: "B", statuses: [{ code: "START" }] },
            { code: "B:C", statuses: [{ code: "D" }] },
          ],
        },
      ],
      { isKnownProcess: () => true, compileQuestions: () => {} },
    );
    const map = new ExternalStatusMap({
      phases: [
        {
          code: "A",
          stages: [
            {
              code: "B",
              statuses: [{ code: "EXTERNAL", source: "CW", mappedTo: "::C:D" }],
            },
          ],
        },
      ],
    });

    expect(() => map.assertTargetsExistIn(lifecycleWithColons)).toThrow(
      'CW status "EXTERNAL" at "A:B" is mapped to "::C:D"',
    );
  });

  it.each([
    ["a status in the mapped stage", "::MISSING"],
    ["a bare status in the mapped stage", "MISSING"],
    ["a fully qualified position", "PRE_AWARD:OTHER:IN_REVIEW"],
    ["two parts", "REVIEW:IN_REVIEW"],
  ])("rejects a mapping to %s that does not exist", (_label, mappedTo) => {
    const map = new ExternalStatusMap(
      mapOf([{ code: "EXTERNAL", source: "CW", mappedTo }]),
    );

    expect(() => map.assertTargetsExistIn(lifecycle)).toThrow(
      `CW status "EXTERNAL" at "PRE_AWARD:REVIEW" is mapped to "${mappedTo}" which does not match any position in "phases"`,
    );
  });
});
