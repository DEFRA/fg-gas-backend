import { describe, expect, it } from "vitest";
import { Position } from "./position.js";

describe("Position", () => {
  describe("parse", () => {
    it("reads a fully qualified position", () => {
      expect(Position.parse("PRE_AWARD:REVIEW:RECEIVED")).toEqual(
        new Position({
          phase: "PRE_AWARD",
          stage: "REVIEW",
          status: "RECEIVED",
        }),
      );
    });

    it.each(["PRE_AWARD", "REVIEW:RECEIVED", "A:B:C:D"])(
      "is null for %s",
      (value) => {
        expect(Position.parse(value)).toBeNull();
      },
    );
  });

  it("is written PHASE:STAGE:STATUS", () => {
    const position = new Position({
      phase: "PRE_AWARD",
      stage: "REVIEW",
      status: "RECEIVED",
    });

    expect(`${position}`).toBe("PRE_AWARD:REVIEW:RECEIVED");
  });

  describe("equals", () => {
    const position = Position.parse("PRE_AWARD:REVIEW:RECEIVED");

    it("is equal to the same position", () => {
      expect(position.equals(Position.parse("PRE_AWARD:REVIEW:RECEIVED"))).toBe(
        true,
      );
    });

    it("is not equal to another position", () => {
      expect(position.equals(Position.parse("PRE_AWARD:REVIEW:HELD"))).toBe(
        false,
      );
    });

    it("is not equal to a position written the same with its codes split differently", () => {
      expect(
        new Position({ phase: "A", stage: "B", status: "C:D" }).equals(
          new Position({ phase: "A", stage: "B:C", status: "D" }),
        ),
      ).toBe(false);
    });

    it("is not equal to no position", () => {
      expect(position.equals(null)).toBe(false);
    });
  });
});
