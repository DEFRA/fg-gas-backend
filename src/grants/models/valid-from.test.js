import { describe, expect, it } from "vitest";
import { ValidFrom } from "./valid-from.js";

describe("ValidFrom", () => {
  describe("with a fully qualified code", () => {
    const validFrom = new ValidFrom({
      code: "PRE_AWARD:REVIEW:RECEIVED",
      processes: [],
    });

    it("matches that position", () => {
      expect(validFrom.matches("PRE_AWARD:REVIEW:RECEIVED")).toBe(true);
    });

    it("does not match the same status in another stage", () => {
      expect(validFrom.matches("PRE_AWARD:OTHER:RECEIVED")).toBe(false);
    });

    it("matches by position", () => {
      expect(validFrom.matchedBy).toBe("position");
    });
  });

  describe("with a status code", () => {
    const validFrom = new ValidFrom({ code: "RECEIVED", processes: [] });

    it("matches that status in any stage", () => {
      expect(validFrom.matches("POST_AWARD:OTHER:RECEIVED")).toBe(true);
    });

    it("does not match another status", () => {
      expect(validFrom.matches("PRE_AWARD:REVIEW:HELD")).toBe(false);
    });

    it("matches by status", () => {
      expect(validFrom.matchedBy).toBe("status");
    });
  });
});
