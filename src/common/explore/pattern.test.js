import { describe, expect, it } from "vitest";
import {
  PATTERN_MESSAGES,
  STEPS_PER_UNIT,
  compilePattern,
  patternProblem,
} from "./pattern.js";
import { compileWhere } from "./evaluate.js";

const at = ({ path }) => ({ path, names: path.split(".") });

const matches = (pattern, flags, value) =>
  compilePattern(pattern, flags)(value).matched;

describe("compilePattern", () => {
  it.each([
    ["hill", "i", "Hilltop Farm", true],
    ["hill", "", "Hilltop Farm", false],
    ["^hill", "i", "a hill", false],
    ["farm$", "i", "Hilltop Farm", true],
    ["^b", "m", "a\nb", true],
    ["^b", "", "a\nb", false],
    ["a$", "m", "a\nb", true],
    ["a.b", "", "a\nb", false],
    ["a.b", "s", "a\nb", true],
    ["\\bfarm\\b", "i", "Hilltop Farm Ltd", true],
    ["\\bfarm\\b", "i", "Farmhouse", false],
    ["\\Barm", "", "farm", true],
    ["gr(a|e)y", "", "grey", true],
    ["^(?:ab)+$", "", "ababab", true],
    ["^(?:ab)+$", "", "ababa", false],
    ["^a{2,3}$", "", "aaa", true],
    ["^a{2,3}$", "", "aaaa", false],
    ["^a{2,}$", "", "aaaaaaaaa", true],
    ["^a{3}$", "", "aa", false],
    ["[a-c]+x", "", "zzbcx", true],
    ["[^0-9]", "", "123", false],
    ["\\d{4}", "", "SX1234 9238", true],
    ["\\s", "", "a\u00a0b", true],
    ["\\w+@\\w+", "", "me@host", true],
    ["a+?b", "", "aaab", true],
    ["(a*)*b", "", "a".repeat(16), false],
    ["(|a)*b", "", "aaab", true],
    ["(a?){20}b", "", "a".repeat(20), false],
    ["\\u00e9", "", "café", true],
    ["É", "i", "café", true],
    ["\\.", "", "a.b", true],
    ["[\\b]", "", "a\bb", true],
    ["😀", "u", "x😀y", true],
    ["^.$", "u", "😀", true],
    ["^.$", "", "😀", false],
  ])(
    "/%s/%s on %j is %s, as RegExp says",
    (pattern, flags, value, expected) => {
      expect(matches(pattern, flags, value)).toBe(expected);
      expect(new RegExp(pattern, flags).test(value)).toBe(expected);
    },
  );

  it("charges a literal as any comparison: one, and one more each 20 characters", () => {
    const charged = [];
    const charge = (units) => charged.push(units);

    expect(compilePattern("9238", "")("SX1234 9238", charge)).toMatchObject({
      matched: true,
      cost: 1,
    });
    expect(compilePattern("9238", "i")("x".repeat(45), charge).cost).toBe(3);
    expect(charged).toEqual([1, 3]);
  });

  it("charges the matcher's steps a unit each STEPS_PER_UNIT, as it goes", () => {
    const charged = [];
    const value = "ab".repeat(5000);
    const outcome = compilePattern("(a|b)*c", "")(value, (units) =>
      charged.push(units),
    );

    // Each state visited, and each class item tested, is a step of work.
    expect(outcome.cost).toBeGreaterThanOrEqual(
      Math.ceil(outcome.steps / STEPS_PER_UNIT),
    );
    expect(charged.reduce((a, b) => a + b, 0)).toBe(outcome.cost);
    expect(charged.length).toBeGreaterThan(5);
  });

  const prose = (length) =>
    "The quick brown fox, jumping; over: the lazy dog! ".repeat(length / 50);
  const EMOJI = String.fromCodePoint(0x1f600);

  // The patterns that held the event loop longest in the verification run:
  // each must charge enough, often enough, to be stopped near the hold limit.
  it.each([
    ["(?:[!-'(-/:-@[-`{-~\\w\\s]{20}){20}#", "i", prose(4500)],
    [
      "(?:[a-bc-de-fg-hi-jk-lm-no-pq-rs-tu-vw-xy-z]{20}){20}#",
      "i",
      "abcdefghij".repeat(400),
    ],
    [
      "(?:[a-bc-de-fg-hi-jk-lm-no-pq-r\\ud800-\\udfff]{20}){20}#",
      "i",
      EMOJI.repeat(4000),
    ],
  ])(
    "charges /%s/%s often enough to stop it near the hold",
    (pattern, flags, value) => {
      const stop = new Error("held");
      const started = Date.now();
      const charge = () => {
        if (Date.now() - started > 50) {
          throw stop;
        }
      };
      let outcome = null;

      try {
        outcome = compilePattern(pattern, flags)(value, charge);
      } catch (error) {
        expect(error).toBe(stop);
      }

      expect(Date.now() - started).toBeLessThan(150);

      if (outcome) {
        expect(outcome.cost * 0.67).toBeGreaterThan(
          (Date.now() - started) * 100,
        );
      }
    },
  );

  it.each([
    ["\\ud83d\\ude00", "u", EMOJI],
    ["[\\ud83d\\ude00]", "u", EMOJI],
    ["\\ud83d\\ude00{0}", "u", ""],
    ["^\\ud83d$", "u", EMOJI],
    ["\\ud83d\\ude00", "", EMOJI],
    ["[\\ud83d\\ude00]", "", "\ud83d"],
  ])("reads the escapes /%s/%s as RegExp does", (pattern, flags, value) => {
    expect(matches(pattern, flags, value)).toBe(
      new RegExp(pattern, flags).test(value),
    );
  });

  it.each(["]", "}", "a}", "\\-", "a]b"])(
    "refuses /%s/u, which RegExp refuses",
    (pattern) => {
      expect(() => new RegExp(pattern, "u")).toThrow();
      expect(patternProblem(pattern, "u")).toBe(PATTERN_MESSAGES.invalid);
    },
  );

  it("can be stopped part way through a long value by its charge", () => {
    const stop = new Error("stop");
    let seen = 0;
    const charge = (units) => {
      seen += units;

      if (seen > 100) {
        throw stop;
      }
    };

    expect(() =>
      compilePattern("(?:(?:a|.){20}){4}z", "")("a".repeat(100_000), charge),
    ).toThrow(stop);
  });

  // Timed against a comparison the meter charges one unit for, in the same
  // run and fastest of many, so a loaded or instrumented machine slows both.
  it("takes about a meter unit of time per unit it charges", () => {
    const matcher = compilePattern("((.?){9}){9}x", "");
    const value = "y".repeat(2000);
    const docs = Array.from({ length: 2000 }, (_, n) => ({
      a: { b: `v${n}` },
    }));
    const compare = compileWhere({ path: "a.b", op: "eq", values: ["v1"] }, at);
    const compareAll = () => {
      expect(docs.filter((doc) => compare(doc, {}))).toHaveLength(1);

      return docs.length;
    };
    const microsEach = (work) => {
      const started = process.hrtime.bigint();
      const units = work();

      return Number(process.hrtime.bigint() - started) / 1000 / units;
    };
    const runs = Array.from({ length: 30 }, () => ({
      pattern: microsEach(() => matcher(value).cost),
      comparison: microsEach(compareAll),
    }));
    const fastest = (key) => Math.min(...runs.map((run) => run[key]));

    expect(fastest("pattern") / fastest("comparison")).toBeGreaterThan(0.25);
    expect(fastest("pattern") / fastest("comparison")).toBeLessThan(3);
  });

  it("charges a pattern the steps it takes, linear in the value's length", () => {
    const { steps: short } = compilePattern("(a|b)*c", "")("ab".repeat(100));
    const { steps: long } = compilePattern("(a|b)*c", "")("ab".repeat(1000));

    expect(long / short).toBeGreaterThan(8);
    expect(long / short).toBeLessThan(12);
  });

  it("never backtracks catastrophically", () => {
    const started = Date.now();

    expect(matches("^(a+)+$", "", `${"a".repeat(5000)}b`)).toBe(false);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it.each([
    ["(a)\\1", "This pattern uses a back-reference, which isn’t supported"],
    ["a(?=b)", "This pattern uses a look-ahead, which isn’t supported"],
    ["a(?!b)", "This pattern uses a look-ahead, which isn’t supported"],
    ["(?<=a)b", "This pattern uses a look-behind, which isn’t supported"],
    ["(?<n>a)", "This pattern uses a named group, which isn’t supported"],
    ["\\p{L}", "This pattern uses a Unicode property, which isn’t supported"],
    ["a{1,21}", "Repeat a part at most 20 times: {1,20}"],
    ["((a{20}){20}){20}", "This pattern is too complex: write a simpler one"],
    ["a".repeat(65), "Keep the pattern to at most 64 characters"],
    ["(a", "This pattern isn’t valid"],
    ["a)", "This pattern isn’t valid"],
    ["*a", "This pattern isn’t valid"],
    ["[b-a]", "This pattern isn’t valid"],
  ])("refuses /%s/", (pattern, message) => {
    expect(patternProblem(pattern, "")).toBe(message);
  });

  it.each([
    "g",
    "ii",
    "y",
    "x",
    "imi",
    "imsuu",
    "imsux",
    "iI",
    "i ",
    "im\u0000",
  ])("refuses the flags %j", (flags) => {
    expect(patternProblem("a", flags)).toBe(
      "Patterns take the flags i, m, s and u, each once",
    );
  });

  it.each(["", "i", "su", "imsu", "usmi"])("takes the flags %j", (flags) => {
    expect(patternProblem("a", flags)).toBeNull();
  });
});

// A fixed seed, so a failure can be run again.
const random = (seed) => () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;

  return seed / 2147483648;
};

const pick = (next, items) => items[Math.floor(next() * items.length)];

// Characters RegExp's i treats specially: the Kelvin sign, dotted and
// dotless i, long s, final sigma, sharp s, a line end, a lone surrogate and
// an astral character.
const SPECIAL = [
  0x212a, 0x130, 0x131, 0x17f, 0x3c2, 0x3c3, 0x3a3, 0xdf, 0x1e9e, 0x2028,
  0xd83d,
].map((code) => String.fromCharCode(code));
const ALPHABET = [
  ..."abABkKsSiI1 \n\r",
  "é",
  "É",
  ...SPECIAL,
  String.fromCodePoint(0x1f600),
];

const ATOMS = [
  "a",
  "b",
  "A",
  "\n",
  ".",
  "\\d",
  "\\w",
  "\\s",
  "[ab]",
  "[^a]",
  "[a-c]",
  "1",
  " ",
  "é",
  "k",
  "s",
  "[k-s]",
  "\\ud83d\\ude00",
  "[\\ud83d\\ude00a]",
  "\\ud83d",
  "}",
  "]",
  "[A-Z]",
  "\\W",
  ...SPECIAL.slice(0, 7),
];
const QUANTIFIERS = [
  "",
  "",
  "",
  "?",
  "*",
  "+",
  "{2}",
  "{1,3}",
  "{0,}",
  "*?",
  "+?",
];

const patternOf = (next, depth = 0) => {
  const parts = Array.from({ length: 1 + Math.floor(next() * 4) }, () => {
    const roll = next();

    if (depth < 2 && roll < 0.15) {
      return `(${patternOf(next, depth + 1)}|${patternOf(next, depth + 1)})${pick(next, QUANTIFIERS)}`;
    }

    if (roll < 0.22) {
      return pick(next, ["^", "$", "\\b", "\\B"]);
    }

    return pick(next, ATOMS) + pick(next, QUANTIFIERS);
  });

  return parts.join("");
};

const valueOf = (next) =>
  Array.from({ length: Math.floor(next() * 12) }, () =>
    pick(next, ALPHABET),
  ).join("");

describe("compilePattern against RegExp", () => {
  const KELVIN = String.fromCharCode(0x212a);
  const LONG_S = String.fromCharCode(0x17f);

  it.each([
    ["k", "i", KELVIN],
    ["i", "i", String.fromCharCode(0x130)],
    ["[a-z]", "i", KELVIN],
    ["[A-Z]", "i", LONG_S],
    ["s", "iu", LONG_S],
    [String.fromCharCode(0x3c3), "iu", String.fromCharCode(0x3c2)],
    ["\\w", "iu", LONG_S],
    ["\\W", "iu", KELVIN],
    ["\\bk", "iu", KELVIN],
    ["\\ud83d", "u", String.fromCodePoint(0x1f600)],
    ["\\ud83d", "", String.fromCodePoint(0x1f600)],
    ["k", "iu", "x" + KELVIN],
  ])("gives RegExp's answer for /%s/%s on %s", (pattern, flags, value) => {
    expect(matches(pattern, flags, value)).toBe(
      new RegExp(pattern, flags).test(value),
    );
  });

  const hex = (ch) => ch.charCodeAt(0).toString(16).padStart(4, "0");
  const single = (text) => [...text].length === 1;
  const isCased = (ch) => ch.toLowerCase() !== ch || ch.toUpperCase() !== ch;
  const casesOf = (ch) =>
    [
      ch,
      ch.toLowerCase(),
      ch.toUpperCase(),
      ch.toUpperCase().toLowerCase(),
      ch.toLowerCase().toUpperCase(),
    ].filter(single);
  const checksOf = (ch) =>
    [`\\u${hex(ch)}`, `[\\u${hex(ch)}-\\u${hex(ch)}]`].flatMap((pattern) =>
      ["i", "iu"].flatMap((flags) =>
        casesOf(ch).map((value) => ({ pattern, flags, value })),
      ),
    );
  const differs = ({ pattern, flags, value }) =>
    compilePattern(pattern, flags)(value).matched !==
    new RegExp(pattern, flags).test(value);

  it("folds case as RegExp does, for every cased character in a pattern or a range", () => {
    const cased = Array.from({ length: 0x10000 }, (_, code) =>
      String.fromCharCode(code),
    ).filter(isCased);

    expect(cased.flatMap(checksOf).filter(differs)).toEqual([]);
  });

  it("gives RegExp's answer for thousands of random patterns and values", () => {
    const next = random(20261113);
    const differences = [];

    for (let n = 0; n < 4000; n += 1) {
      const pattern = patternOf(next);
      const flags = ["", "i", "m", "s", "u", "im", "is", "iu", "ms"][n % 9];

      if (patternProblem(pattern, flags) === null) {
        const value = valueOf(next);
        const ours = compilePattern(pattern, flags)(value).matched;
        const theirs = new RegExp(pattern, flags).test(value);

        if (ours !== theirs) {
          differences.push({ pattern, flags, value, ours, theirs });
        }
      }
    }

    expect(differences).toEqual([]);
  });
});
