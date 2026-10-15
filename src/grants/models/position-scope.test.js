import { describe, expect, it } from "vitest";
import { PositionScope } from "./position-scope.js";

const props = {
  phase: "PRE_AWARD",
  stage: "ASSESSMENT",
  status: "APPLICATION_RECEIVED",
};

describe("PositionScope", () => {
  it("holds the phase, stage and status", () => {
    expect(new PositionScope(props)).toEqual(props);
  });

  it("serialises as an object holding only the parts it declares", () => {
    expect(JSON.stringify(new PositionScope({ phase: props.phase }))).toBe(
      '{"phase":"PRE_AWARD"}',
    );
  });

  describe("toString", () => {
    it("joins the parts it declares with colons", () => {
      expect(new PositionScope(props).toString()).toBe(
        "PRE_AWARD:ASSESSMENT:APPLICATION_RECEIVED",
      );
      expect(new PositionScope({ phase: props.phase }).toString()).toBe(
        "PRE_AWARD",
      );
    });
  });

  describe("covers", () => {
    it("covers a position with the same phase, stage and status", () => {
      expect(new PositionScope(props).covers({ ...props })).toBe(true);
    });

    it.each([
      ["phase", "POST_AWARD"],
      ["stage", "AWARD"],
      ["status", "IN_REVIEW"],
    ])("does not cover a position whose %s differs", (part, value) => {
      expect(new PositionScope(props).covers({ ...props, [part]: value })).toBe(
        false,
      );
    });

    it("covers any stage and status when it declares only a phase", () => {
      expect(new PositionScope({ phase: props.phase }).covers(props)).toBe(
        true,
      );
    });

    it("still requires the phase to be the same when it declares only a phase", () => {
      expect(new PositionScope({ phase: "POST_AWARD" }).covers(props)).toBe(
        false,
      );
    });

    it("covers any status when it declares a phase and stage", () => {
      const { phase } = props;

      expect(
        new PositionScope({ phase, stage: props.stage }).covers(props),
      ).toBe(true);
      expect(new PositionScope({ phase, stage: "AWARD" }).covers(props)).toBe(
        false,
      );
    });

    it("reads a null stage and status as not declared", () => {
      const declared = new PositionScope({
        phase: props.phase,
        stage: null,
        status: null,
      });

      expect(declared.covers(props)).toBe(true);
    });
  });

  describe("areAll", () => {
    it("returns true for a list of scopes, an empty list and no list", () => {
      expect(PositionScope.areAll([new PositionScope(props)])).toBe(true);
      expect(PositionScope.areAll([])).toBe(true);
      expect(PositionScope.areAll(undefined)).toBe(true);
      expect(PositionScope.areAll(null)).toBe(true);
    });

    it("returns false when an entry is not a scope", () => {
      expect(PositionScope.areAll([new PositionScope(props), props])).toBe(
        false,
      );
    });
  });

  describe("anyCovers", () => {
    const scopes = [
      new PositionScope({ phase: "POST_AWARD" }),
      new PositionScope({ phase: props.phase, stage: props.stage }),
    ];

    it("returns true when one of the scopes covers the position", () => {
      expect(PositionScope.anyCovers(scopes, props)).toBe(true);
    });

    it("returns false when none of the scopes covers the position", () => {
      expect(PositionScope.anyCovers(scopes, { phase: "CLAIM" })).toBe(false);
      expect(PositionScope.anyCovers([], props)).toBe(false);
    });

    it("returns false without a position", () => {
      expect(PositionScope.anyCovers(scopes, undefined)).toBe(false);
    });
  });
});
