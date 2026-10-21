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

  describe("a bucket led by a fact that hides a value", () => {
    const led = ledBucket();

    it("holds the lead before the facts of every line, and before refs", () => {
      expect(factsOf(led, [])).toEqual(["eventType"]);
      expect(factsOf(led, ["status"])).toEqual(["eventType", "status"]);
      expect(factsOf(led, REFS)).toEqual(["eventType"]);
    });

    it("fills with the values shown, or with all once the fact is shown", () => {
      expect(fillOf(led, "eventType", [])).toEqual([
        "case.create",
        "case.update.status",
      ]);
      expect(fillOf(led, "eventType", ["eventType"])).toEqual([
        "case.create",
        "case.update.status",
        "audit",
      ]);
      expect(scansOf(led, [], [])).toBe(3);
      expect(scansOf(led, [], [], ["eventType"])).toBe(4);
    });

    it("stays exact with the lead filled, shown or not", () => {
      const plan = {
        kind: EXACT,
        line: [],
        filled: ["eventType"],
        residual: [],
      };

      expect(choosePlan(led, [], false)).toEqual(plan);
      expect(choosePlan(led, [], false, ["eventType"])).toEqual(plan);
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
      expect(scansOf(led, REFS, ["status"])).toBe(3);
    });
  });

  describe("a fact that hides a value outside the lead", () => {
    const loose = ledBucket({
      lead: [],
      indexes: [["status"], ["status", "eventType"]],
    });

    it("takes the line that holds it, filling what is not asked", () => {
      expect(choosePlan(loose, [], false)).toEqual({
        kind: EXACT,
        line: ["status", "eventType"],
        filled: ["status", "eventType"],
        residual: [],
      });
      expect(scansOf(loose, ["status", "eventType"], [])).toBe(24);
    });

    it("reads the time-only line once the fact is shown", () => {
      expect(choosePlan(loose, [], false, ["eventType"]).line).toEqual([]);
    });

    it("is a residual behind a ref, whose key does not hold it", () => {
      expect(choosePlan(loose, [], true)).toEqual({
        kind: BOUNDED,
        line: REFS,
        filled: [],
        residual: ["eventType"],
      });
      expect(choosePlan(loose, [], true, ["eventType"]).kind).toBe(EXACT);
    });
  });
});
