import { describe, expect, it } from "vitest";
import { Position } from "./position.js";

const props = {
  phase: "PRE_AWARD",
  stage: "ASSESSMENT",
  status: "APPLICATION_RECEIVED",
};

describe("Position", () => {
  it("holds the phase, stage and status", () => {
    expect(new Position(props)).toEqual(props);
  });

  describe("withStatus", () => {
    it("returns a position in the same phase and stage with the given status", () => {
      const position = new Position(props).withStatus("IN_REVIEW");

      expect(position).toBeInstanceOf(Position);
      expect(position).toEqual({ ...props, status: "IN_REVIEW" });
    });

    it("leaves the original position unchanged", () => {
      const position = new Position(props);

      position.withStatus("IN_REVIEW");

      expect(position).toEqual(props);
    });
  });

  describe("parse", () => {
    it("reads a phase, stage and status separated by colons", () => {
      const position = Position.parse(
        "PRE_AWARD:ASSESSMENT:APPLICATION_RECEIVED",
      );

      expect(position).toBeInstanceOf(Position);
      expect(position).toEqual(props);
    });

    it.each([
      "PRE_AWARD:ASSESSMENT:APPLICATION_RECEIVED",
      "PRE_AWARD:ASSESSMENT",
      "PRE_AWARD",
      "PRE_AWARD::APPLICATION_RECEIVED",
      "::APPLICATION_RECEIVED",
      "PRE_AWARD:ASSESSMENT:APPLICATION_RECEIVED:EXTRA",
      "",
    ])("reads %j back as the same code", (code) => {
      expect(Position.parse(code).toString()).toBe(code);
    });

    it("keeps anything after the stage as the status", () => {
      expect(Position.parse("PRE_AWARD:ASSESSMENT:A:B")).toEqual({
        phase: "PRE_AWARD",
        stage: "ASSESSMENT",
        status: "A:B",
      });
    });

    it("leaves out the parts a shorter code does not name", () => {
      expect(Position.parse("PRE_AWARD")).toEqual({
        phase: "PRE_AWARD",
        stage: undefined,
        status: undefined,
      });
    });
  });

  describe("resolve", () => {
    const position = new Position(props);

    it.each(["IN_REVIEW", "::IN_REVIEW"])(
      "keeps the phase and stage for %j",
      (code) => {
        expect(position.resolve(code)).toEqual({
          ...props,
          status: "IN_REVIEW",
        });
      },
    );

    it("returns the position a fully qualified code names", () => {
      const resolved = position.resolve("POST_AWARD:AWARD:OFFER_ACCEPTED");

      expect(resolved).toBeInstanceOf(Position);
      expect(resolved).toEqual({
        phase: "POST_AWARD",
        stage: "AWARD",
        status: "OFFER_ACCEPTED",
      });
    });

    it.each(["POST_AWARD:AWARD", "POST_AWARD:AWARD:OFFER_ACCEPTED:EXTRA"])(
      "returns null for %j, which is neither a status nor a whole position",
      (code) => {
        expect(position.resolve(code)).toBeNull();
      },
    );

    it("reads everything after a leading :: as the status", () => {
      expect(position.resolve("::A:B").status).toBe("A:B");
    });
  });

  describe("toString", () => {
    it("joins the phase, stage and status with colons", () => {
      expect(new Position(props).toString()).toBe(
        "PRE_AWARD:ASSESSMENT:APPLICATION_RECEIVED",
      );
    });

    it("leaves out an absent status", () => {
      const position = new Position({ phase: props.phase, stage: props.stage });

      expect(position.toString()).toBe("PRE_AWARD:ASSESSMENT");
    });

    it("leaves out a null stage and status", () => {
      const position = new Position({
        phase: props.phase,
        stage: null,
        status: null,
      });

      expect(position.toString()).toBe("PRE_AWARD");
    });
  });

  describe("equals", () => {
    it("returns true for the same phase, stage and status", () => {
      expect(new Position(props).equals({ ...props })).toBe(true);
    });

    it.each([
      ["phase", "POST_AWARD"],
      ["stage", "AWARD"],
      ["status", "IN_REVIEW"],
    ])("returns false when the %s differs", (part, value) => {
      expect(new Position(props).equals({ ...props, [part]: value })).toBe(
        false,
      );
    });

    it("returns false for a position that leaves a part out", () => {
      expect(new Position(props).equals({ phase: props.phase })).toBe(false);
    });
  });

  describe("hasSameCode", () => {
    it("returns true for a position with the same phase, stage and status", () => {
      expect(new Position(props).hasSameCode(new Position(props))).toBe(true);
    });

    it("returns false when a part differs", () => {
      const other = new Position(props).withStatus("IN_REVIEW");

      expect(new Position(props).hasSameCode(other)).toBe(false);
    });

    it("returns true for positions whose missing parts leave the same code", () => {
      const withoutStage = new Position({ phase: "PRE_AWARD", status: "X" });
      const withoutStatus = new Position({ phase: "PRE_AWARD", stage: "X" });

      expect(withoutStage.hasSameCode(withoutStatus)).toBe(true);
      expect(withoutStage.equals(withoutStatus)).toBe(false);
    });
  });

  describe("incompletePart", () => {
    it("returns undefined when every part is a non-empty string", () => {
      expect(new Position(props).incompletePart()).toBeUndefined();
    });

    it.each([
      ["phase", undefined],
      ["stage", null],
      ["status", "  "],
      ["status", 5],
    ])("names the %s when it is %j", (part, value) => {
      const position = new Position({ ...props, [part]: value });

      expect(position.incompletePart()).toBe(part);
    });

    it("names the first of several incomplete parts", () => {
      expect(new Position({ status: "X" }).incompletePart()).toBe("phase");
    });
  });

  describe("matchesCode", () => {
    const position = new Position(props);

    it("matches a fully qualified code naming the same position", () => {
      expect(
        position.matchesCode("PRE_AWARD:ASSESSMENT:APPLICATION_RECEIVED"),
      ).toBe(true);
    });

    it("does not match a fully qualified code naming another position", () => {
      expect(position.matchesCode("PRE_AWARD:AWARD:APPLICATION_RECEIVED")).toBe(
        false,
      );
    });

    it("matches a bare code against the status alone", () => {
      expect(position.matchesCode("APPLICATION_RECEIVED")).toBe(true);
      expect(position.matchesCode("ASSESSMENT")).toBe(false);
    });

    it("throws for a code that is not a string", () => {
      expect(() => position.matchesCode(undefined)).toThrow(TypeError);
    });
  });
});
