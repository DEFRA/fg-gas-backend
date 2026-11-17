import { describe, expect, it } from "vitest";
import { refusalOf, refuseQuery } from "./refusal.js";

describe("refuseQuery", () => {
  it("carries its code, and only a known code is read back", () => {
    expect(refusalOf(refuseQuery("TOO_BIG"))).toBe("TOO_BIG");
    expect(refuseQuery("TOO_BIG").message).toBe(
      "Explore query refused: TOO_BIG",
    );
    expect(refusalOf(Object.assign(new Error("x"), { refusal: "OTHER" }))).toBe(
      null,
    );
    expect(refusalOf(undefined)).toBe(null);
  });
});
