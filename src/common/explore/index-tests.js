import { MAX_SCANS } from "../buckets/plan.js";
import { isOidTag } from "./evaluate-read.js";
import { isDayText, isInstantText } from "./evaluate.js";

export const NESTED = "NESTED";
export const NOT_INDEXED = "NOT_INDEXED";
export const NOT_INDEX_OPERATOR = "NOT_INDEX_OPERATOR";
export const REPEATED = "REPEATED";
export const SECOND_REF = "SECOND_REF";
export const WITHOUT_PARTNER = "WITHOUT_PARTNER";
export const TOO_MANY_COMBINATIONS = "TOO_MANY_COMBINATIONS";
export const TOO_MANY_IDS = "TOO_MANY_IDS";

// The most ObjectIds one id read takes, every id test's together.
export const MAX_IDS = 50;

export const RESIDUAL_REASONS = [
  NESTED,
  NOT_INDEXED,
  NOT_INDEX_OPERATOR,
  REPEATED,
  SECOND_REF,
  WITHOUT_PARTNER,
  TOO_MANY_COMBINATIONS,
  TOO_MANY_IDS,
];

const TIME_OPS = ["eq", "lt", "lte", "gt", "gte"];

const ID = "_id";

const isDate = (value) =>
  value !== null && typeof value === "object" && Object.hasOwn(value, "date");

// Null in a list also means no value, which no index entry holds.
const noNull = ({ values }) => !values.includes(null);

// No ref is blank: a blank value is tested record by record.
const noBlank = ({ values }) =>
  values.every((value) => value !== null && value !== "");

// A text bound is a time when it compares as text just as its instant does
// with times stored as `toISOString()` writes them: a day, or an instant so
// written. Any other text, and equality with typed text, stays text, tested
// record by record.
const isTextBound = (value) =>
  typeof value === "string" && (isDayText(value) || isInstantText(value));

const isBound = (value) => isDate(value) || isTextBound(value);

const OPERATORS = {
  fact: ({ closed }, test) =>
    noNull(test) &&
    (["eq", "in"].includes(test.op) ||
      (closed && ["ne", "nin"].includes(test.op))),
  ref: (_, test) => noBlank(test) && ["eq", "in"].includes(test.op),
  refs: (_, test) => noBlank(test) && ["eq", "in"].includes(test.op),
  time: (_, { op, values }) =>
    TIME_OPS.includes(op) &&
    (op === "eq" ? isDate(values[0]) : isBound(values[0])),
  box: () => true,
  // Only `_id` is read through the `_id` index.
  id: (_, { path, op, values }) =>
    path === ID && ["eq", "in"].includes(op) && values.every(isOidTag),
};

const isLeaf = (test) => Object.hasOwn(test, "op");

const indexedField = (fieldOf, test) => {
  const field = test.path === undefined ? null : fieldOf(test.path);

  return field?.index ? field : null;
};

const widthOf = ({ op, values }) =>
  ["in", "nin"].includes(op) ? values.length : 1;

// Why a top-level test can't be read through the bucket's index, given what
// the tests before it took; null when it can.
const REASONS = [
  (test) => (isLeaf(test) ? null : NESTED),
  (_test, field) => (field ? null : NOT_INDEXED),
  (test, field) =>
    OPERATORS[field.index](field, test) ? null : NOT_INDEX_OPERATOR,
  (_test, field, taken) =>
    field.index === "fact" && taken.facts.has(field.path) ? REPEATED : null,
  (_test, field, taken) =>
    isRef(field) && taken.ref !== null ? SECOND_REF : null,
  (test, field, taken) =>
    field.index === "fact" && taken.scans * widthOf(test) > MAX_SCANS
      ? TOO_MANY_COMBINATIONS
      : null,
  // A list of refs is one index scan a ref, times the bucket's lead.
  (test, field) =>
    isRef(field) && widthOf(test) * (field.scans ?? 1) > MAX_SCANS
      ? TOO_MANY_COMBINATIONS
      : null,
];

const UNION_OPS = ["eq", "in"];

const REF_KINDS = ["ref", "refs"];

// A ref path, read through the refs index as a ref of its kind, or `refs`
// itself, read as stored.
const isRef = (field) => REF_KINDS.includes(field.index);

const UNION_KINDS = new Set(["fact", "id", ...REF_KINDS]);

const isUnionTest = (test) => UNION_OPS.includes(test.op) && noBlank(test);

const isUnionBranch = (fieldOf) => (test) => {
  const field = isLeaf(test) ? indexedField(fieldOf, test) : null;

  return Boolean(field) && isUnionTest(test) && UNION_KINDS.has(field.index);
};

const isOneUnion = (branches, fieldOf) =>
  branches.every(({ path }) => path === branches[0].path) ||
  branches.every(({ path }) => isRef(fieldOf(path)));

const isUnion = (branches, fieldOf) =>
  branches.length > 0 &&
  branches.every(isUnionBranch(fieldOf)) &&
  isOneUnion(branches, fieldOf);

const unionBranches = (test, fieldOf) => {
  const branches = Object.hasOwn(test, "any") ? test.any : [];

  return isUnion(branches, fieldOf) ? branches : null;
};

// A top-level $or of index tests on one path, or on refs of any kinds, is
// one $in: the index reads the union of their bounds. `paths` names each
// value's path, for refs of several kinds, and `branches` keeps the tests.
const unionOf = (test, fieldOf) => {
  const branches = unionBranches(test, fieldOf);

  return branches
    ? {
        path: branches[0].path,
        op: "in",
        values: branches.flatMap(({ values }) => values),
        paths: branches.flatMap(({ path, values }) => values.map(() => path)),
        branches,
      }
    : test;
};

const reasonOf = (test, field, taken) => {
  for (const reason of REASONS) {
    const why = reason(test, field, taken);

    if (why) {
      return why;
    }
  }

  return null;
};

const take = (taken, test, field) => {
  if (field.index === "fact") {
    taken.facts.add(field.path);
    taken.scans *= widthOf(test);
  }

  if (isRef(field)) {
    taken.ref = field.path;
  }
};

// A test read beside no partner is tested as it was asked.
const withPartners = (classified, taken) =>
  classified.map((entry) =>
    !entry.why && entry.field.within && !taken.facts.has(entry.field.within)
      ? { ...entry, test: entry.asked, why: WITHOUT_PARTNER }
      : entry,
  );

const isIdTest = ({ why, field }) => !why && field.index === "id";

// Every id test's ObjectIds, once each, when there are at most MAX_IDS;
// more, and each id test is tested record by record instead.
const withIds = (classified, taken) => {
  const ids = [
    ...new Set(
      classified
        .filter(isIdTest)
        .flatMap(({ test }) => test.values.map(({ oid }) => oid)),
    ),
  ];

  if (ids.length <= MAX_IDS) {
    taken.ids = ids;

    return classified;
  }

  return classified.map((entry) =>
    isIdTest(entry)
      ? { ...entry, test: entry.asked, why: TOO_MANY_IDS }
      : entry,
  );
};

// Each top-level test of a WHERE, and whether it is read through the index:
// `why` is null when it is, else the reason it is tested record by record.
// `fieldOf` names a path's index kind, whether its values are closed, and
// the path it is within. The checker and the planner both read tests so.
// `taken.ids` holds the ObjectIds of an id read (isIdRead): the read is of
// those records only, and every other test is tested on each.
export const classifyTests = (conditions, fieldOf) => {
  const taken = { facts: new Set(), ref: null, scans: 1, ids: [] };
  const classified = conditions.map((asked) => {
    const test = unionOf(asked, fieldOf);
    const field = isLeaf(test) ? indexedField(fieldOf, test) : null;
    const why = reasonOf(test, field, taken);

    if (!why) {
      take(taken, test, field);
    }

    return { test: why ? asked : test, asked, field, why };
  });

  return {
    tests: withIds(withPartners(classified, taken), taken).map(
      ({ asked: _asked, ...entry }) => entry,
    ),
    taken,
  };
};

// Whether the tests taken make an id read: exact, whatever else is tested.
export const isIdRead = (taken) => taken.ids.length > 0;

export const topLevelOf = (where) => {
  if (!where) {
    return [];
  }

  return Object.hasOwn(where, "all") ? where.all : [where];
};

// The paths a condition could use to be read through the index, given the
// ref already read: a path within another is offered beside it.
export const usablePaths = (paths, taken) =>
  paths
    .filter(({ index }) => index && index !== "id")
    .filter(
      (field) =>
        !isRef(field) || taken.ref === null || taken.ref === field.path,
    )
    .map(({ path, within }) => (within ? `${path} with ${within}` : path));
