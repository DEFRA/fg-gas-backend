import { describe, expect, it } from "vitest";
import { exploreVocabulary } from "../../../test/helpers/explore-vocabulary.js";
import { isLimitTyped, limitOf } from "./csv.js";
import { readQuery } from "./language/query.js";

const vocabulary = exploreVocabulary();

const readOf = (text) => readQuery(text, vocabulary);

describe("isLimitTyped", () => {
  it.each([
    ["db.applications.find({}).limit(10)", true],
    [
      "db.applications.aggregate([{ $group: { _id: '$code' } }, { $limit: 3 }])",
      true,
    ],
    ["db.applications.find({})", false],
    ["db.applications.aggregate([{ $group: { _id: '$code' } }])", false],
    ["db.applications.distinct('code')", false],
  ])("%s: %s", (text, typed) => {
    expect(isLimitTyped(readOf(text).tree)).toBe(typed);
  });
});

describe("limitOf", () => {
  const query = { limit: 10, columns: [{ path: "code" }] };

  it.each([
    ["a page: the LIMIT GPA sends", { limit: 25 }, true, null, 25, 25],
    ["a page: the query's own", {}, false, null, 10, 10],
    ["a CSV of no windows: the typed limit", { csv: true }, true, null, 10, 10],
    [
      "a CSV with no typed limit: 5,000",
      { csv: true },
      false,
      null,
      5000,
      5000,
    ],
    [
      "a CSV down to positions: 5,000 read, the typed limit shown when read in one go",
      { csv: true },
      true,
      {},
      5000,
      10,
    ],
  ])("%s", (_, body, typed, target, limit, shows) => {
    expect(limitOf({ body, query, typed, target })).toEqual({ limit, shows });
  });

  it("cuts a limit to the cells an answer may hold", () => {
    const wide = { limit: 5000, columns: Array(20).fill({ path: "code" }) };

    expect(
      limitOf({ body: { csv: true }, query: wide, typed: false, target: null }),
    ).toEqual({ limit: 1000, shows: 1000 });
  });
});
