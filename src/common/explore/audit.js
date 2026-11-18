import { valueDigest } from "./digest.js";
import { plainValue } from "./evaluate.js";
import { testsOf } from "./query-schema.js";
import { exprKey } from "./rows.js";

const pathOf = ({ path }) => path;

const isObject = (value) => value !== null && typeof value === "object";

// A value as one text of its type: a pattern as typed, `/source/flags`; a
// date as its instant; any other value as JSON, so '5' and 5 differ.
const digestText = (value) => {
  if (isObject(value) && Object.hasOwn(value, "pattern")) {
    return `/${value.pattern}/${value.flags}`;
  }

  return isObject(value)
    ? `ISODate(${new Date(plainValue(value)).toISOString()})`
    : JSON.stringify(value);
};

const digestsOf = (key, test) =>
  test.values.length
    ? {
        digests: test.values.map((value) =>
          valueDigest(key, `${pathOf(test)}:${digestText(value)}`),
        ),
      }
    : {};

// Each test's path, as `known` lets it show, and operator; its values only as
// digests keyed with `key`, none for a presence test. Without a key there is
// no audit to write.
export const conditionsOf = (where, key, known = new Set()) => {
  if (!key) {
    throw new Error("Explore audit has no SEARCH_AUDIT_KEY");
  }

  return testsOf(where).map((test) => ({
    path: shownPath(pathOf(test), known),
    op: test.op,
    ...digestsOf(key, test),
  }));
};

const listOf = ({ values }) => `[${values.map(() => "?").join(", ")}]`;

const OPS = {
  eq: () => "?",
  ne: () => "{ $ne: ? }",
  lt: () => "{ $lt: ? }",
  lte: () => "{ $lte: ? }",
  gt: () => "{ $gt: ? }",
  gte: () => "{ $gte: ? }",
  in: (test) => `{ $in: ${listOf(test)} }`,
  nin: (test) => `{ $nin: ${listOf(test)} }`,
  regex: () => "/?/",
  empty: () => "{ $exists: false }",
  filled: () => "{ $exists: true }",
};

const NODES = {
  all: (node, shape) => `$and: [${node.all.map(shape).join(", ")}]`,
  any: (node, shape) => `$or: [${node.any.map(shape).join(", ")}]`,
  not: (node, shape) => `$nor: [${shape(node.not)}]`,
};

const entryOf = (node) => {
  const kind = Object.keys(NODES).find((name) => Object.hasOwn(node, name));

  return kind
    ? NODES[kind](node, filterOf)
    : `${keyOfPath(pathOf(node))}: ${OPS[node.op](node)}`;
};

const filterOf = (node) => `{ ${entryOf(node)} }`;

const WORD = /^\w+$/;

// A path as mongosh writes a key: in quotes when it has a dot.
const keyOfPath = (path) => (WORD.test(path) ? path : `'${path}'`);

const whereOf = ({ where }) => (where ? filterOf(where) : "{}");

// The operators and keys the language reads and the shape writes.
const LANGUAGE_KEYS = new Set([
  "$eq",
  "$ne",
  "$gt",
  "$gte",
  "$lt",
  "$lte",
  "$in",
  "$nin",
  "$exists",
  "$regex",
  "$options",
  "$not",
  "$and",
  "$or",
  "$nor",
  "$match",
  "$unwind",
  "$group",
  "$project",
  "$sort",
  "$limit",
  "$sum",
  "$min",
  "$max",
  "$count",
  "$size",
  "_id",
  "path",
  "preserveNullAndEmptyArrays",
]);

// A name as the shape shows it: an operator or key of the language, or a
// word the source's paths are made of; any other, `$` first or not, may be
// someone's words, so it shows as '?'.
export const shapeKey = (name, known) =>
  LANGUAGE_KEYS.has(name) || known.has(name) ? name : "'?'";

const workedOut = ({ fn, path }) => {
  if (fn === "count") {
    return path === "*" ? "{ $sum: 1 }" : `{ $size: '$${path}' }`;
  }

  return `{ $${fn}: '$${path}' }`;
};

const nameOfColumn = (column, known) =>
  column.as === undefined ? "'?'" : shapeKey(column.as, known);

const columnOf = (known) => (column) => {
  if (column.fn) {
    return `${nameOfColumn(column, known)}: ${workedOut(column)}`;
  }

  return column.as === undefined
    ? `${keyOfPath(column.path)}: 1`
    : `${shapeKey(column.as, known)}: '$${column.path}'`;
};

const projectionOf = ({ columns }, known) =>
  `{ ${columns.map(columnOf(known)).join(", ")} }`;

const isShownAs = (orderBy) => (column) =>
  column.as !== undefined && exprKey(column) === exprKey(orderBy);

// A sort names a column it shows, or a path.
const sortKeyOf = ({ columns, orderBy }, known) => {
  const shown = columns.find(isShownAs(orderBy));

  return shown ? shapeKey(shown.as, known) : keyOfPath(orderBy.path);
};

const directionOf = ({ desc }) => (desc ? -1 : 1);

const orderOf = (query, known) =>
  query.orderBy
    ? `.sort({ ${sortKeyOf(query, known)}: ${directionOf(query.orderBy)} })`
    : "";

const accumulatorsOf = ({ columns }, known) =>
  columns
    .filter(({ fn }) => fn)
    .map(columnOf(known))
    .join(", ");

const unwindOf = ({ path, preserve }) =>
  `{ $unwind: { path: '$${path}', preserveNullAndEmptyArrays: ${preserve} } }, `;

const unwindsOf = (query) => query.unwind.map(unwindOf).join("");

const stageSortOf = (query, known) =>
  query.orderBy
    ? `{ $sort: { ${sortKeyOf(query, known)}: ${directionOf(query.orderBy)} } }, `
    : "";

const findOf = (query, known) =>
  `find(${whereOf(query)}, ${projectionOf(query, known)})${orderOf(query, known)}.limit(?)`;

const unwoundRowsOf = (query, known) =>
  `aggregate([{ $match: ${whereOf(query)} }, ${unwindsOf(query)}{ $project: ${projectionOf(query, known)} }, ${stageSortOf(query, known)}{ $limit: ? }])`;

const MODES = {
  rows: (query, known) =>
    query.unwind.length ? unwoundRowsOf(query, known) : findOf(query, known),
  groups: (query, known) =>
    `aggregate([{ $match: ${whereOf(query)} }, ${unwindsOf(query)}{ $group: { _id: '$${query.groupBy.path}', ${accumulatorsOf(query, known)} } }])${orderOf(query, known)}.limit(?)`,
  count: (query) => `countDocuments(${whereOf(query)})`,
  distinct: (query) => `distinct('${query.groupBy.path}', ${whereOf(query)})`,
};

// A path as the shape shows it: each segment one of the source's own words,
// any other, which may be someone's words or a key of data (digits too: a
// map can be keyed by a number), as ?.
export const shownPath = (path, known) =>
  path
    .split(".")
    .map((name) => (known.has(name) ? name : "?"))
    .join(".");

// The words a source's paths are made of: its roots and the paths it knows.
export const knownWordsOf = (paths) =>
  new Set(paths.flatMap((path) => path.split(".")));

const shownRef = (known) => (ref) =>
  ref && ref.path !== "*" ? { ...ref, path: shownPath(ref.path, known) } : ref;

const shownWhere = (node, show) => {
  const kind = Object.keys(NODES).find((name) => Object.hasOwn(node, name));

  if (!kind) {
    return show(node);
  }

  return kind === "not"
    ? { not: shownWhere(node.not, show) }
    : { [kind]: node[kind].map((child) => shownWhere(child, show)) };
};

const shownQuery = (query, known) => {
  const show = shownRef(known);

  return {
    ...query,
    where: query.where && shownWhere(query.where, show),
    unwind: query.unwind.map(show),
    columns: query.columns.map(show),
    groupBy: show(query.groupBy),
    orderBy: show(query.orderBy),
  };
};

// A Query as mongosh would write it, each value as ?, its paths as `known`
// lets them show, for a service that has only the Query.
export const queryShapeOf = (query, known) => {
  const shown = shownQuery(query, known);

  return `db.${shown.source}.${MODES[shown.mode](shown, known)}`;
};
