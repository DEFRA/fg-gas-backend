import { describe, expect, it } from "vitest";
import {
  BOUNDED,
  EXACT,
  MAX_SCANS,
  REFS,
  SCAN_BUDGET,
  choosePlan,
  factsOf,
  fillOf,
  scansOf,
} from "./plan.js";
import { ledBucket, testBucket } from "./test-bucket.js";

describe("plan", () => {
  const bucket = testBucket();

  it("starts from the verdict's budget and scan cap", () => {
    expect(SCAN_BUDGET).toBe(20_000);
    expect(MAX_SCANS).toBe(50);
  });

  describe("scansOf", () => {
    it("is one scan when every fact of the line is asked", () => {
      expect(
        scansOf(bucket, ["status", "eventType"], ["status", "eventType"]),
      ).toBe(1);
    });

    it("multiplies by the number of values asked of each bound fact", () => {
      expect(
        scansOf(bucket, ["status", "eventType"], ["status", "eventType"], {
          status: 3,
          eventType: 2,
        }),
      ).toBe(6);
      expect(
        scansOf(bucket, ["status", "eventType"], ["status"], { status: 3 }),
      ).toBe(9);
    });

    it("multiplies the listed values plus null of each filled fact", () => {
      expect(scansOf(bucket, ["status", "eventType"], ["eventType"])).toBe(8);
      expect(scansOf(bucket, ["status", "eventType"], [])).toBe(24);
    });
  });

  describe("choosePlan", () => {
    it("reads the time-only line when nothing is asked", () => {
      expect(choosePlan(bucket, [], false)).toEqual({
        kind: EXACT,
        line: [],
        filled: [],
        residual: [],
      });
    });

    it("is exact on the line that holds every asked fact", () => {
      expect(choosePlan(bucket, ["status", "eventType"], false)).toEqual({
        kind: EXACT,
        line: ["status", "eventType"],
        filled: [],
        residual: [],
      });
    });

    it("leaves a line whose values asked would take more scans than the cap, so the read is bounded", () => {
      const wide = testBucket({
        indexes: [["status"], ["eventType", "status"], ["code"]],
      });
      const asked = ["eventType", "status"];

      expect(
        choosePlan(wide, asked, false, { eventType: 2, status: 7 }),
      ).toMatchObject({ kind: EXACT, line: ["eventType", "status"] });
      expect(
        choosePlan(wide, asked, false, { eventType: 8, status: 7 }),
      ).toMatchObject({
        kind: BOUNDED,
        line: ["status"],
        residual: ["eventType"],
      });
    });

    it("prefers the line with fewer scans when two bind the same facts", () => {
      expect(choosePlan(bucket, ["status"], false).line).toEqual(["status"]);
    });

    it("fills a leading closed fact that was not asked", () => {
      expect(choosePlan(bucket, ["eventType"], false)).toEqual({
        kind: EXACT,
        line: ["status", "eventType"],
        filled: ["status"],
        residual: [],
      });
    });

    it("is bounded when no line holds an asked fact", () => {
      expect(choosePlan(bucket, ["status", "grantCode"], false)).toEqual({
        kind: BOUNDED,
        line: ["status"],
        filled: [],
        residual: ["grantCode"],
      });
    });

    it("leads a bounded read on a filled line", () => {
      expect(choosePlan(bucket, ["eventType", "grantCode"], false)).toEqual({
        kind: BOUNDED,
        line: ["status", "eventType"],
        filled: ["status"],
        residual: ["grantCode"],
      });
    });

    it("leads on the time-only line when no line binds an asked fact", () => {
      expect(choosePlan(bucket, ["grantCode"], false)).toEqual({
        kind: BOUNDED,
        line: [],
        filled: [],
        residual: ["grantCode"],
      });
    });

    it("never fills a stored fact", () => {
      expect(choosePlan(bucket, [], false).line).toEqual([]);
      expect(choosePlan(bucket, ["code"], false)).toEqual({
        kind: EXACT,
        line: ["code"],
        filled: [],
        residual: [],
      });
    });

    it("does not use a line that needs more than the scan cap", () => {
      const wide = testBucket({
        indexes: [["status", "source", "eventType"], ["code"]],
      });

      expect(choosePlan(wide, ["eventType"], false)).toEqual({
        kind: EXACT,
        line: ["status", "source", "eventType"],
        filled: ["status", "source"],
        residual: [],
      });

      const wider = testBucket({
        indexes: [["status", "eventType", "source"], ["code"]],
      });

      expect(choosePlan(wider, [], false).line).toEqual([]);
      expect(choosePlan(wider, ["source"], false)).toEqual({
        kind: EXACT,
        line: ["status", "eventType", "source"],
        filled: ["status", "eventType"],
        residual: [],
      });
      expect(scansOf(wider, wider.indexes[0], [])).toBeGreaterThan(MAX_SCANS);
    });

    it("leads on refs and is exact for a ref alone", () => {
      expect(choosePlan(bucket, [], true)).toEqual({
        kind: EXACT,
        line: REFS,
        filled: [],
        residual: [],
      });
    });

    it("tests every asked fact as a residual behind a ref", () => {
      expect(choosePlan(bucket, ["status", "grantCode"], true)).toEqual({
        kind: BOUNDED,
        line: REFS,
        filled: [],
        residual: ["status", "grantCode"],
      });
    });
  });

  describe("a bucket led by a fact", () => {
    const led = ledBucket();

    it("holds the lead before the facts of every line, and before refs", () => {
      expect(factsOf(led, [])).toEqual(["eventType"]);
      expect(factsOf(led, ["status"])).toEqual(["eventType", "status"]);
      expect(factsOf(led, REFS)).toEqual(["eventType"]);
    });

    it("fills the lead with every value it lists, and null", () => {
      expect(fillOf(led, "eventType")).toEqual([
        "case.create",
        "case.update.status",
        "audit",
      ]);
      expect(scansOf(led, [], [])).toBe(4);
    });

    it("stays exact with the lead filled", () => {
      expect(choosePlan(led, [], false)).toEqual({
        kind: EXACT,
        line: [],
        filled: ["eventType"],
        residual: [],
      });
      expect(choosePlan(led, ["status"], false)).toEqual({
        kind: EXACT,
        line: ["status"],
        filled: ["eventType"],
        residual: [],
      });
    });

    it("binds the lead when it is asked", () => {
      expect(choosePlan(led, ["eventType", "status"], false)).toEqual({
        kind: EXACT,
        line: ["status"],
        filled: [],
        residual: [],
      });
      expect(choosePlan(led, ["eventType"], false)).toEqual({
        kind: EXACT,
        line: [],
        filled: [],
        residual: [],
      });
    });

    it("binds or fills the lead in front of a ref", () => {
      expect(choosePlan(led, ["eventType"], true)).toEqual({
        kind: EXACT,
        line: REFS,
        filled: [],
        residual: [],
      });
      expect(choosePlan(led, ["status"], true)).toEqual({
        kind: BOUNDED,
        line: REFS,
        filled: ["eventType"],
        residual: ["status"],
      });
      expect(scansOf(led, REFS, ["status"])).toBe(4);
    });
  });

  describe("an events list with one index per filter shape", () => {
    const types = Array.from({ length: 18 }, (_, n) => ({
      value: `type-${n}`,
      label: `type-${n}`,
    }));
    const events = testBucket({
      facts: {
        status: testBucket().facts.status,
        eventType: { label: "Event", param: "event", values: types },
      },
      indexes: [["status"], ["eventType"], ["eventType", "status"]],
      groupings: [],
      columns: [],
    });
    const widths = (eventType, status) => ({ eventType, status });

    it.each([
      ["nothing", [], []],
      ["a status", ["status"], ["status"]],
      ["a type", ["eventType"], ["eventType"]],
      ["a type and a status", ["eventType", "status"], ["eventType", "status"]],
    ])(
      "takes the index of just its facts for %s, exact in one scan",
      (_, asked, line) => {
        expect(choosePlan(events, asked, false)).toEqual({
          kind: EXACT,
          line,
          filled: [],
          residual: [],
        });
        expect(scansOf(events, line, asked)).toBe(1);
      },
    );

    it.each([1, 2, 3, 4, 5])(
      "stays exact for %i statuses and no type, one scan each",
      (statuses) => {
        const plan = choosePlan(events, ["status"], false, {
          status: statuses,
        });

        expect(plan).toEqual({
          kind: EXACT,
          line: ["status"],
          filled: [],
          residual: [],
        });
        expect(
          scansOf(events, plan.line, ["status"], { status: statuses }),
        ).toBe(statuses);
      },
    );

    it.each([
      [7, 7, EXACT, ["eventType", "status"]],
      [18, 2, EXACT, ["eventType", "status"]],
      [10, 5, EXACT, ["eventType", "status"]],
      [18, 3, BOUNDED, ["status"]],
      [8, 7, BOUNDED, ["status"]],
    ])(
      "%i types and %i statuses: %s on %j",
      (typeCount, statusCount, kind, line) => {
        expect(
          choosePlan(
            events,
            ["eventType", "status"],
            false,
            widths(typeCount, statusCount),
          ),
        ).toMatchObject({ kind, line });
      },
    );
  });
});
