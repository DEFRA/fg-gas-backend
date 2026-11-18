import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { exploreVocabulary } from "../../../../test/helpers/explore-vocabulary.js";
import { patternProblem } from "../../../common/explore/pattern.js";
import { readQuery } from "./query.js";

// Whatever a user types, the answer is a Query or { message, at, end }:
// never a thrown error, so never a 500.
const corpus = JSON.parse(
  readFileSync(new URL("./corpus.json", import.meta.url), "utf8"),
);

const random = (seed) => {
  let state = seed;

  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;

    return state / 2_147_483_648;
  };
};

const pick = (next, list) => list[Math.floor(next() * list.length)];

const PIECES = [
  ..."{}[]():,.;/\\'\"$-",
  "db",
  "applications",
  "cases",
  "find",
  "aggregate",
  "countDocuments",
  "distinct",
  "sort",
  "limit",
  "$match",
  "$group",
  "$sort",
  "$limit",
  "$project",
  "$in",
  "$regex",
  "$options",
  "$not",
  "$or",
  "$sum",
  "$size",
  "$count",
  "$exists",
  "_id",
  "ref",
  "business",
  "created",
  "anything",
  "ISODate",
  "null",
  "true",
  "1",
  "-1",
  "4.5",
  "'x'",
  "'$ref'",
  "/a[\\B]/i",
  "/(a|b)*c/",
  "// note\n",
  " ",
  "\n",
];

const soup = (next) =>
  Array.from({ length: 1 + Math.floor(next() * 30) }, () =>
    pick(next, PIECES),
  ).join("");

const MUTATIONS = [
  (text, at) => text.slice(0, at),
  (text, at) => text.slice(0, at) + text.slice(at + 1),
  (text, at, piece) => text.slice(0, at) + piece + text.slice(at),
  (text, at) => text.slice(0, at) + text[at] + text.slice(at),
];

const mutated = (next, text) => {
  const at = Math.floor(next() * (text.length + 1));

  return pick(next, MUTATIONS)(text, at, pick(next, PIECES));
};

const vocabulary = exploreVocabulary();
const UNAVAILABLE = [...vocabulary.unavailable.values()];

// A source whose service didn't answer throws that service's own failure.
const outcomeOf = (text) => {
  try {
    const result = readQuery(text, vocabulary);

    return result.error ?? result.query;
  } catch (error) {
    return UNAVAILABLE.includes(error) ? "unavailable" : error;
  }
};

const isAnswer = (outcome) =>
  outcome === "unavailable" ||
  typeof outcome.message === "string" ||
  typeof outcome.mode === "string";

describe("readQuery never throws", () => {
  it("on random token soup", () => {
    const next = random(1113);
    const thrown = Array.from({ length: 3000 }, () => soup(next))
      .map((text) => [text, outcomeOf(text)])
      .filter(([, outcome]) => !isAnswer(outcome));

    expect(thrown).toEqual([]);
  });

  it("on every corpus query, mutated", () => {
    const next = random(2026);
    const texts = corpus.entries.flatMap(({ text }) =>
      Array.from({ length: 20 }, () => mutated(next, text)),
    );
    const thrown = texts
      .map((text) => [text, outcomeOf(text)])
      .filter(([, outcome]) => !isAnswer(outcome));

    expect(thrown).toEqual([]);
  });

  it("on random patterns and flags", () => {
    const next = random(64);
    const chars = [..."ab()[]{}|*+?^$.\\-,0123456789:=!<>BbdDwWsSuxkcp"];
    const thrown = [];

    for (let n = 0; n < 5000; n += 1) {
      const pattern = Array.from({ length: Math.floor(next() * 16) }, () =>
        pick(next, chars),
      ).join("");
      const flags = pick(next, ["", "i", "u", "iu", "msu", "g", "ii"]);

      try {
        patternProblem(pattern, flags);
      } catch (error) {
        thrown.push({ pattern, flags, error: error.message });
      }
    }

    expect(thrown).toEqual([]);
  });
});
