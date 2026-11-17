import {
  ASCII,
  MAX_PATTERN_LENGTH,
  MAX_STATES,
  PATTERN_MESSAGES,
  caseOf,
  failUnless,
  parseTree,
  setsOf,
} from "./pattern-tree.js";
import { LENGTH_STEP, builder, runVm, statesOf } from "./pattern-vm.js";

export {
  MAX_PATTERN_LENGTH,
  MAX_REPEAT,
  MAX_STATES,
  PATTERN_MESSAGES,
} from "./pattern-tree.js";
export { STEPS_PER_UNIT } from "./pattern-vm.js";

const FLAGS = "imsu";

// ── A literal, the usual case, is a substring search ──

const literalOf = (tree) => {
  const items = tree.type === "sequence" ? tree.items : [];
  const literal = items.length && items.every(({ type }) => type === "char");

  return literal ? items.map(({ ch }) => ch).join("") : null;
};

const noCharge = () => {};

// A literal search, charged as any comparison. With i only ASCII text is
// lowered here; any other goes to the matcher, which folds as RegExp does.
const literalMatcher = (literal, folding, matcher) => {
  const wanted = folding ? literal.toLowerCase() : literal;
  const search = (value, charge) => {
    const cost = 1 + Math.floor(value.length / LENGTH_STEP);

    charge(cost);

    return {
      matched: (folding ? value.toLowerCase() : value).includes(wanted),
      steps: value.length,
      cost,
    };
  };

  return (value, charge = noCharge) =>
    folding && !ASCII.test(value)
      ? matcher(value, charge)
      : search(value, charge);
};

const optionsOf = (flags) => ({
  folding: flags.includes("i"),
  multiline: flags.includes("m"),
  dotAll: flags.includes("s"),
  unicode: flags.includes("u"),
});

const areFlags = (flags) =>
  flags.length <= FLAGS.length &&
  new Set(flags).size === flags.length &&
  [...flags].every((flag) => FLAGS.includes(flag));

const checkText = (pattern, flags) => {
  failUnless(
    typeof pattern === "string" && pattern.length <= MAX_PATTERN_LENGTH,
    PATTERN_MESSAGES.length,
  );
  failUnless(
    typeof flags === "string" && areFlags(flags),
    PATTERN_MESSAGES.flags,
  );
};

const splitterOf = (unicode) =>
  unicode ? (value) => [...value] : (value) => value.split("");

const vmMatcher = (tree, options) => {
  const cases = caseOf(options.unicode);
  const built = { ...options, ...cases };
  const program = builder({ ...built, sets: setsOf(built) })(tree);
  const split = splitterOf(options.unicode);
  const word = setsOf(built).w;

  return (value, charge = noCharge) =>
    runVm(program, split(value), {
      multiline: options.multiline,
      word,
      charge,
    });
};

const isFast = (literal) => literal !== null && ASCII.test(literal);

// A pattern as a test of a value: JavaScript's RegExp meaning over the
// supported subset, in time linear in the value's length. The test is told
// `charge`, which it calls with the units of work it takes as it goes, often
// enough that a long value can be stopped part way; it answers whether the
// value matched, the steps and the units. Throws, naming why, a pattern that
// can't be used.
export const compilePattern = (pattern, flags = "") => {
  checkText(pattern, flags);

  const options = optionsOf(flags);
  const tree = parseTree(pattern, options.unicode);

  failUnless(statesOf(tree) <= MAX_STATES, PATTERN_MESSAGES.states);

  const literal = literalOf(tree);

  const matcher = vmMatcher(tree, options);

  return isFast(literal)
    ? literalMatcher(literal, options.folding, matcher)
    : matcher;
};

// Why a pattern can't be used, or null.
export const patternProblem = (pattern, flags) => {
  try {
    compilePattern(pattern, flags);

    return null;
  } catch (error) {
    if (!error.pattern) {
      throw error;
    }

    return error.message;
  }
};

const isUsable = ({ values: [value] }) =>
  patternProblem(value.pattern, value.flags) === null;

// Whether every `regex` test's pattern is one the matcher takes.
export const usablePatterns = (tests) =>
  tests.filter(({ op }) => op === "regex").every(isUsable);
