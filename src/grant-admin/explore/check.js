import {
  MAX_IDS,
  NESTED,
  NOT_INDEXED,
  NOT_INDEX_OPERATOR,
  REPEATED,
  SECOND_REF,
  TOO_MANY_COMBINATIONS,
  TOO_MANY_IDS,
  WITHOUT_PARTNER,
  classifyTests,
  isIdRead,
  topLevelOf,
  usablePaths,
} from "../../common/explore/index-tests.js";

export { MAX_CELLS } from "../../common/explore/query-schema.js";

const COUNTED_BY = {
  groups: "$group",
  count: "countDocuments",
  distinct: "distinct",
};

const isUnwinding = (query) => Boolean(query.unwind?.length);

const countedBy = (query) =>
  COUNTED_BY[query.mode] ?? (isUnwinding(query) ? "$unwind" : "This query");

export const CHECK_MESSAGES = {
  countWindowed: (method, reason, fields) =>
    `${method} counts every record, so every condition must be read through an index, but ${reason}. Conditions read so: ${fields}`,
  orderWindowed: (reason, fields) =>
    `This query reads newest first, a window at a time. A sort needs every condition read through an index, but ${reason}. Conditions read so: ${fields}`,
};

const VALUE_OR_IN = "a value or $in";

const OPERATORS_OF = {
  fact: ({ closed }) => (closed ? "a value, $ne, $in or $nin" : VALUE_OR_IN),
  ref: () => VALUE_OR_IN,
  refs: () => VALUE_OR_IN,
  time: () => "an ISODate and $gt, $gte, $lt or $lte",
  box: () => "a value",
  id: () => "ObjectId('…') or $in of them",
};

const NULL_IN = "NULL_IN";

const REASONS = {
  [NULL_IN]: (name) =>
    `${name} with null in $in, which also means no value, is read a record at a time`,
  [NESTED]: () =>
    "a condition under $or, $nor or $not is read a record at a time",
  [NOT_INDEXED]: (name) => `${name} is read a record at a time`,
  [NOT_INDEX_OPERATOR]: (name, field) =>
    `${name} is read through its index only with ${OPERATORS_OF[field.index](field)}`,
  [REPEATED]: (name) => `${name} is read through its index only once`,
  [SECOND_REF]: (name) =>
    `only one reference is read through its index, and ${name} is a second`,
  [WITHOUT_PARTNER]: (name, field) =>
    `${name} is read through its index only beside ${field.within}`,
  [TOO_MANY_COMBINATIONS]: (name) =>
    name
      ? `${name} makes too many combinations of values`
      : "the conditions make too many combinations of values",
  [TOO_MANY_IDS]: (name) =>
    `${name} is read through its index for at most ${MAX_IDS} ObjectIds in all`,
};

const pathsOf = (source) => (path) =>
  (path !== undefined && source.paths.get(path)) || null;

const reasonOf = (source, { why, path }) =>
  (REASONS[why] ?? REASONS[TOO_MANY_COMBINATIONS])(
    path,
    pathsOf(source)(path) ?? {},
  );

// The indexed paths that would narrow a query. `untested` leaves out a path
// it already tests at the top; one tested inside $or still narrows once
// moved up.
export const narrowingPaths = (source, where, { untested = false } = {}) => {
  const tested = new Set(
    untested ? topLevelOf(where).map(({ path }) => path) : [],
  );

  return usablePaths(
    [...source.paths.values()],
    classifyTests(topLevelOf(where), pathsOf(source)).taken,
  ).filter((path) => !tested.has(path.split(" ")[0]));
};

const readSo = (source, where) => narrowingPaths(source, where).join(", ");

// The message for a read that can't be exact, naming why and the conditions
// that would be read through the index. `why` and `path` say which test.
export const windowedMessage = (code, { source, query, detail }) =>
  code === "ORDER_NEEDS_EXACT"
    ? CHECK_MESSAGES.orderWindowed(
        reasonOf(source, detail),
        readSo(source, query.where),
      )
    : CHECK_MESSAGES.countWindowed(
        countedBy(query),
        reasonOf(source, detail),
        readSo(source, query.where),
      );

// The reader writes newest first, the read's own order, as none.
const isNewestFirst = (orderBy) => !orderBy;

const countsEvery = (query) => query.mode !== "rows" || isUnwinding(query);

// An id read is exact whatever else the query tests.
const firstResidual = (source, where) => {
  const { tests, taken } = classifyTests(topLevelOf(where), pathsOf(source));

  return isIdRead(taken) ? null : (tests.find(({ why }) => why) ?? null);
};

const firstLeaf = (node) => {
  const branch = ["all", "any"].find((name) => Object.hasOwn(node, name));

  if (branch) {
    return firstLeaf(node[branch][0]);
  }

  return node.not ? firstLeaf(node.not) : node;
};

const problemAt = (message, node) => ({ message, at: node.at, end: node.end });

// { p: { $in: [null, 'a'] } } is "p has no value, or is 'a'".
const isNullIn = (test) =>
  test.op === "in" && (test.values ?? []).includes(null);

const detailOf = ({ why, test }) => ({
  why: isNullIn(test) ? NULL_IN : why,
  path: test.path,
});

const residualProblem = (source, query, spans, residual) => {
  const detail = detailOf(residual);

  if (countsEvery(query)) {
    return problemAt(
      windowedMessage("GROUP_NEEDS_EXACT", { source, query, detail }),
      spans.tests.get(firstLeaf(residual.test)),
    );
  }

  return isNewestFirst(query.orderBy)
    ? null
    : problemAt(
        windowedMessage("ORDER_NEEDS_EXACT", { source, query, detail }),
        spans.sort,
      );
};

// A big source is read exact (every top-level condition through the index)
// or newest first a window at a time. $group, countDocuments, distinct and
// any order but newest first need it exact: the first problem, or null.
export const readProblem = (source, query, spans) => {
  const residual =
    source.size === "big" ? firstResidual(source, query.where) : null;

  return residual ? residualProblem(source, query, spans, residual) : null;
};
