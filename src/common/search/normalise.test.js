import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalise } from "./normalise.js";

// Shared with GPA, which folds a searched value the same way.
const vectors = JSON.parse(
  readFileSync(
    new URL(
      "../../../test/fixtures/search-normalise-vectors.json",
      import.meta.url,
    ),
  ),
);

describe("normalise", () => {
  it.each([
    ["O’Neill-Smith Farm", "oneillsmithfarm"],
    ["o'neill smith farm", "oneillsmithfarm"],
    ["ONEILLSMITHFARM", "oneillsmithfarm"],
    ["SX0679 9238", "sx06799238"],
    ["SX0679-9238", "sx06799238"],
    ["Crème Brûlée Ltd.", "cremebruleeltd"],
    ["İzmir", "izmir"],
    ["ﬁeld №2", "fieldno2"],
    [42.5, "425"],
    ["Straße", "strasse"],
    ["STRAẞE", "strasse"],
    ["Łukasz Wałęsa", "lukaszwalesa"],
    ["Æble Øster", "aebleoster"],
    ["æble øster", "aebleoster"],
    ["Đurđević", "durdevic"],
    ["Þórr", "thorr"],
    ["Œuvre cœur", "oeuvrecoeur"],
  ])("normalises %j to %j", (value, expected) => {
    expect(normalise(value)).toBe(expected);
  });

  it("answers an empty string for a value with no letters or digits", () => {
    expect(normalise(" -'’. ")).toBe("");
  });

  it.each(vectors)("normalises $input as GPA does", ({ input, normalised }) => {
    expect(normalise(input)).toBe(normalised);
  });
});
