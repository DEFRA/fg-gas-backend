import { describe, expect, it } from "vitest";
import { cappedField, storedBytes } from "./capped-projection.js";

describe("cappedField", () => {
  it("keeps the value only while the stored document is within the cap", () => {
    expect(cappedField("$definition", 1024)).toEqual({
      $cond: [{ $lte: [storedBytes, 1024] }, "$definition", "$$REMOVE"],
    });
  });

  it("measures the whole stored document", () => {
    expect(storedBytes).toEqual({ $bsonSize: "$$ROOT" });
  });
});
