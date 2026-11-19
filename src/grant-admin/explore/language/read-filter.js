import { isDateText } from "../../../common/explore/evaluate.js";
import { EVENT_BOXES, EVENT_SERVICES } from "../../../events/event-boxes.js";
import { pathProblem } from "../../../common/explore/paths.js";
import { patternProblem } from "../../../common/explore/pattern.js";
import {
  MAX_TESTS,
  MAX_VALUE_LENGTH,
  MAX_VALUES,
} from "../../../common/explore/query-schema.js";
import { LOGIC } from "./allowlist.js";
import { READ_MESSAGES, fail, isObject, notAllowed } from "./read-messages.js";

// ── Paths ──

// A stored path the source may read, as typed: well formed, under one of its
// roots, nothing in it denied.
export const pathOf = (ctx, path, node) => {
  const problem = pathProblem(path, ctx.source);

  return problem
    ? fail(READ_MESSAGES[problem](path, ctx.source), node)
    : { path };
};

export const isRef = (node) =>
  node.type === "text" && node.value.startsWith("$") && node.value.length > 1;

// '$path': a path of the source, named in text.
export const refOf = (ctx, node, what) =>
  isRef(node)
    ? pathOf(ctx, node.value.slice(1), node)
    : fail(READ_MESSAGES.ref(what), node);

// ── Values ──

const dateValue = (node) =>
  isDateText(node.value)
    ? { date: node.value }
    : fail(READ_MESSAGES.date, {
        at: node.valueAt,
        end: node.valueEnd,
      });

const VALUES = {
  text: (node) => node.value,
  number: (node) => node.value,
  literal: (node) => node.value,
  date: dateValue,
};

const scalarOf = (node, message = READ_MESSAGES.value) =>
  Object.hasOwn(VALUES, node.type)
    ? VALUES[node.type](node)
    : fail(message, node);

// What the union of the events' boxes adds to each record holds only these.
const BOX_VALUES = new Map([
  ["service", EVENT_SERVICES],
  ["box", EVENT_BOXES],
]);

const isText = (value) => typeof value === "string";

const boxValuesOf = (ctx, path) =>
  ctx.source.paths.get(path)?.index === "box"
    ? (BOX_VALUES.get(path) ?? null)
    : null;

const isBoxValue = (values, value) =>
  !values || value === null || values.some((entry) => entry.value === value);

const isLong = (value) => isText(value) && value.length > MAX_VALUE_LENGTH;

// Text never equals or compares with a stored Date, so text on a time some
// box stores as a Date can't be what was meant.
const isDateStored = (ctx, path) =>
  ctx.source.paths.get(path)?.stored === "date";

const VALUE_RULES = [
  [(_ctx, _path, value) => isLong(value), () => READ_MESSAGES.valueLength],
  [
    (ctx, path, value) => isText(value) && isDateStored(ctx, path),
    (path) => READ_MESSAGES.dateStored(path),
  ],
  [
    (ctx, path, value) => !isBoxValue(boxValuesOf(ctx, path), value),
    (path) => READ_MESSAGES[path],
  ],
];

const checkValue = (ctx, path, value, node) =>
  VALUE_RULES.forEach(([breaks, message]) => {
    if (breaks(ctx, path, value)) {
      fail(message(path), node);
    }
  });

// ── Filters ──

// One test, counted against the query's limits, its node kept for where a
// later rule points.
const leaf = (ctx, target, test, node) => {
  ctx.tests += 1;

  if (ctx.tests > MAX_TESTS) {
    fail(READ_MESSAGES.tests, node);
  }

  const result = { path: target.path, ...test };

  ctx.spans.set(result, node);

  return result;
};

const valueLeaf = (ctx, target, op, items) => {
  items.forEach(([value, node]) => checkValue(ctx, target.path, value, node));

  return leaf(
    ctx,
    target,
    { op, values: items.map(([value]) => value) },
    items[0][1],
  );
};

const bare = (ctx, target, op, node) =>
  leaf(ctx, target, { op, values: [] }, node);

const regexLeaf = (ctx, target, { pattern, flags }, node) => {
  const problem = patternProblem(pattern, flags);

  if (problem) {
    fail(problem, node);
  }

  return leaf(ctx, target, { op: "regex", values: [{ pattern, flags }] }, node);
};

// { path: null } holds when the path holds null or isn't there, as Mongo's.
const equalityLeaf = (op) => (ctx, target, entry) =>
  valueLeaf(ctx, target, op, [[scalarOf(entry.value), entry.value]]);

const compareLeaf = (op) => (ctx, target, entry) => {
  const value = scalarOf(entry.value, READ_MESSAGES.compared);

  return value === null
    ? fail(READ_MESSAGES.compared, entry.value)
    : valueLeaf(ctx, target, op, [[value, entry.value]]);
};

const listItems = (entry) => {
  const list = entry.value;

  if (list.type !== "array" || !list.items.length) {
    fail(READ_MESSAGES.inList(entry.key), entry);
  }

  if (list.items.length > MAX_VALUES) {
    fail(READ_MESSAGES.values, list.items[MAX_VALUES]);
  }

  return list.items.map((node) => [scalarOf(node), node]);
};

// $in with null also matches a path that isn't there, as Mongo's.
const listLeaf = (op) => (ctx, target, entry) =>
  valueLeaf(ctx, target, op, listItems(entry));

// $exists takes true or false, or 1 or 0 as mongosh users write it.
const EXISTS = new Map([
  [true, "filled"],
  [1, "filled"],
  [false, "empty"],
  [0, "empty"],
]);

const existsLeaf = (ctx, target, entry) => {
  const { type, value } = entry.value;
  const op = ["literal", "number"].includes(type) ? EXISTS.get(value) : null;

  return op
    ? bare(ctx, target, op, entry.value)
    : fail(READ_MESSAGES.exists, entry.value);
};

const flagsOf = (options, given) => {
  if (!options) {
    return given;
  }

  if (given) {
    fail(READ_MESSAGES.flagsTwice, options);
  }

  return options.value.type === "text"
    ? options.value.value
    : fail(READ_MESSAGES.optionsText, options.value);
};

const PATTERN_OF = {
  pattern: (node) => ({ pattern: node.pattern, flags: node.flags }),
  text: (node) => ({ pattern: node.value, flags: "" }),
};

const regexEntryLeaf = (ctx, target, entry, options) => {
  const node = entry.value;
  const read = Object.hasOwn(PATTERN_OF, node.type)
    ? PATTERN_OF[node.type](node)
    : fail(READ_MESSAGES.regex, node);

  return regexLeaf(
    ctx,
    target,
    { pattern: read.pattern, flags: flagsOf(options, read.flags) },
    node,
  );
};

const notLeaf = (ctx, target, entry) => {
  const node = entry.value;

  if (node.type === "pattern") {
    return { not: regexLeaf(ctx, target, node, node) };
  }

  return isObject(node) && node.entries.length
    ? { not: operatorTest(ctx, target, node) }
    : fail(READ_MESSAGES.not, node);
};

const OP_LEAVES = new Map([
  ["$eq", equalityLeaf("eq")],
  ["$ne", equalityLeaf("ne")],
  ["$gt", compareLeaf("gt")],
  ["$gte", compareLeaf("gte")],
  ["$lt", compareLeaf("lt")],
  ["$lte", compareLeaf("lte")],
  ["$in", listLeaf("in")],
  ["$nin", listLeaf("nin")],
  ["$exists", existsLeaf],
  ["$not", notLeaf],
]);

const optionsIn = (node) => {
  const options = node.entries.find(({ key }) => key === "$options");

  if (options && !node.entries.some(({ key }) => key === "$regex")) {
    fail(READ_MESSAGES.options, options);
  }

  return options;
};

const opEntryTest = (ctx, target, entry, options) => {
  if (entry.key === "$regex") {
    return regexEntryLeaf(ctx, target, entry, options);
  }

  return OP_LEAVES.has(entry.key)
    ? OP_LEAVES.get(entry.key)(ctx, target, entry)
    : fail(notAllowed(entry.key, READ_MESSAGES.notAnOp), entry);
};

// Tests that must all hold, one level: { $nin: [null, 'a'] } is two of them.
const allOf = (tests) => {
  const flat = tests.flatMap((test) =>
    Object.hasOwn(test, "all") ? test.all : [test],
  );

  return flat.length === 1 ? flat[0] : { all: flat };
};

// { $gt: 4, $lt: 9 }: each operator a test on the one path, all of them.
const operatorTest = (ctx, target, node) => {
  const options = optionsIn(node);

  return allOf(
    node.entries
      .filter((entry) => entry !== options)
      .map((entry) => opEntryTest(ctx, target, entry, options)),
  );
};

const isOperatorObject = (node) =>
  node.entries.length > 0 && node.entries[0].key.startsWith("$");

const objectTest = (ctx, target, node) => {
  if (isOperatorObject(node)) {
    return operatorTest(ctx, target, node);
  }

  const [first] = node.entries;

  return fail(READ_MESSAGES.notAnOp(first ? first.key : "{}"), first ?? node);
};

const VALUE_TESTS = {
  pattern: (ctx, target, node) => regexLeaf(ctx, target, node, node),
  array: (_ctx, target, node) => fail(READ_MESSAGES.list(target.path), node),
  object: objectTest,
};

const pathValueTest = (ctx, target, node) => {
  if (Object.hasOwn(VALUE_TESTS, node.type)) {
    return VALUE_TESTS[node.type](ctx, target, node);
  }

  return equalityLeaf("eq")(ctx, target, { value: node });
};

const pathTest = (ctx, entry) =>
  pathValueTest(ctx, pathOf(ctx, entry.key, entry), entry.value);

const logicTest = (ctx, entry) => {
  const list = entry.value;

  if (list.type !== "array" || !list.items.length) {
    fail(READ_MESSAGES.logic(entry.key), entry);
  }

  const tests = list.items.map(
    (item) => filterOf(ctx, item) ?? fail(READ_MESSAGES.emptyFilter, item),
  );
  const kind = LOGIC.get(entry.key);

  return kind === "nor" ? { not: { any: tests } } : { [kind]: tests };
};

const entryTest = (ctx, entry) => {
  if (LOGIC.has(entry.key)) {
    return logicTest(ctx, entry);
  }

  return entry.key.startsWith("$")
    ? fail(notAllowed(entry.key, READ_MESSAGES.notHere), entry)
    : pathTest(ctx, entry);
};

// A filter to the Query's `where`: null for {}.
export const filterOf = (ctx, node) => {
  if (!isObject(node)) {
    fail(READ_MESSAGES.filter, node);
  }

  const tests = node.entries.map((entry) => entryTest(ctx, entry));

  return tests.length ? allOf(tests) : null;
};
