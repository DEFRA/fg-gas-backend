import {
  MAX_COLUMNS,
  MAX_LIMIT,
  MAX_UNWINDS,
  QUERY_VERSIONS,
} from "../../../common/explore/query-schema.js";
import {
  ACCUMULATORS,
  EXPRESSIONS,
  MAX_STAGES,
  REPEATED_STAGES,
  STAGES,
} from "./allowlist.js";
import { MAX_CELLS } from "../check.js";
import {
  MAX_NAME,
  READ_MESSAGES,
  ReadError,
  fail,
  isNumber,
  isObject,
  isOne,
  isZero,
  notAllowed,
  onlyEntry,
} from "./read-messages.js";
import { filterOf, isRef, pathOf, refOf } from "./read-filter.js";

export { READ_MESSAGES } from "./read-messages.js";

const DEFAULT_LIMIT = 50;

// ── Columns ──

const checkName = (entry) => {
  if (entry.key === "") {
    fail(READ_MESSAGES.emptyName, entry);
  }

  if (entry.key.startsWith("$")) {
    fail(READ_MESSAGES.dollarName(entry.key), entry);
  }

  return entry.key.length > MAX_NAME
    ? fail(READ_MESSAGES.name, entry)
    : entry.key;
};

const expressionColumn = (ctx, entry) => {
  const inner = onlyEntry(entry.value);
  const fn = inner ? EXPRESSIONS.get(inner.key) : undefined;

  if (!fn) {
    fail(READ_MESSAGES.show, entry);
  }

  const { path } = refOf(ctx, inner.value, inner.key);

  return { fn, path, as: checkName(entry) };
};

const projectedColumn = (ctx, entry) => {
  if (isOne(entry.value)) {
    return pathOf(ctx, entry.key, entry);
  }

  if (isRef(entry.value)) {
    return { ...refOf(ctx, entry.value, entry.key), as: checkName(entry) };
  }

  return expressionColumn(ctx, entry);
};

const columnOfEntry = (ctx, entry) => {
  if (!isZero(entry.value)) {
    return [projectedColumn(ctx, entry), entry];
  }

  return entry.key === "_id" ? null : fail(READ_MESSAGES.zero, entry);
};

const checkColumns = (pairs) => {
  if (pairs.length > MAX_COLUMNS) {
    fail(READ_MESSAGES.columns, pairs[MAX_COLUMNS][1]);
  }

  return pairs.map(([column]) => column);
};

// A projection to columns: null when it names none, for the defaults.
const projectionOf = (ctx, node) => {
  if (!isObject(node)) {
    fail(READ_MESSAGES.fields, node);
  }

  const pairs = node.entries
    .map((entry) => columnOfEntry(ctx, entry))
    .filter(Boolean);

  return pairs.length ? checkColumns(pairs) : null;
};

const defaultColumns = (source) => source.star.map((path) => ({ path }));

// ── $group ──

const summed = (ctx, node) => ({ fn: "sum", ...refOf(ctx, node, "$sum") });

// $sum: 1 counts; any other number is refused, as summing it is no answer.
const sumColumn = (ctx, inner) => {
  if (isNumber(inner.value, 1)) {
    return { fn: "count", path: "*" };
  }

  return inner.value.type === "number"
    ? fail(READ_MESSAGES.sumOne, inner.value)
    : summed(ctx, inner.value);
};

const ACCUMULATOR_COLUMNS = {
  sum: sumColumn,
  count: (_ctx, inner) =>
    isObject(inner.value) && !inner.value.entries.length
      ? { fn: "count", path: "*" }
      : fail(READ_MESSAGES.count, inner.value),
  min: (ctx, inner) => ({ fn: "min", ...refOf(ctx, inner.value, "$min") }),
  max: (ctx, inner) => ({ fn: "max", ...refOf(ctx, inner.value, "$max") }),
};

const accumulatorColumn = (ctx, entry) => {
  const inner = onlyEntry(entry.value);
  const fn = inner ? ACCUMULATORS.get(inner.key) : undefined;

  return fn
    ? [{ ...ACCUMULATOR_COLUMNS[fn](ctx, inner), as: checkName(entry) }, entry]
    : fail(READ_MESSAGES.work(entry.key), entry);
};

const groupOf = (ctx, node, stage) => {
  if (!isObject(node)) {
    fail(READ_MESSAGES.group, node);
  }

  const id = node.entries.find(({ key }) => key === "_id");
  const { path } = id
    ? refOf(ctx, id.value, "_id")
    : fail(READ_MESSAGES.groupId, stage);
  const accumulators = node.entries
    .filter((entry) => entry !== id)
    .map((entry) => accumulatorColumn(ctx, entry));

  return {
    groupBy: { path },
    columns: checkColumns([[{ path }, id], ...accumulators]),
  };
};

// ── Sort and limit ──

const SORT_WAYS = new Map([
  [1, false],
  [-1, true],
]);

const keyOf = ({ path, fn = null }) => ({ path, fn });

const groupSortKey = (entry, { path }) =>
  ["_id", path].includes(entry.key)
    ? { path, fn: null }
    : fail(READ_MESSAGES.sortGroups, entry);

// A sort key is a column's name, else the group's path, else a path.
const sortKeyOf = (ctx, entry, read) => {
  const named = (read.columns ?? []).find(({ as }) => as === entry.key);

  if (named) {
    return keyOf(named);
  }

  return read.groupBy
    ? groupSortKey(entry, read.groupBy)
    : { ...pathOf(ctx, entry.key, entry), fn: null };
};

const sortOf = (ctx, node, read) => {
  const entry = onlyEntry(node) ?? fail(READ_MESSAGES.sortOne, node);
  const desc =
    entry.value.type === "number"
      ? SORT_WAYS.get(entry.value.value)
      : undefined;

  if (desc === undefined) {
    fail(READ_MESSAGES.sortWay, entry.value);
  }

  ctx.sortAt = entry;

  return { ...sortKeyOf(ctx, entry, read), desc };
};

const limitNode = (ctx, node, message) => {
  const fits =
    node.type === "number" && Number.isInteger(node.value) && node.value >= 1;

  ctx.limitAt = node;

  return fits ? node.value : fail(message, node);
};

// ── The methods ──

const argsOf = (call, most, message) => {
  if (call.args.length > most) {
    fail(message, call.args[most]);
  }

  return call.args;
};

const CHAINS = {
  sort: (ctx, call, read) => ({
    orderBy: sortOf(
      ctx,
      argsOf(call, 1, READ_MESSAGES.sortOne)[0] ?? call,
      read,
    ),
  }),
  limit: (ctx, call) => ({
    limit: limitNode(
      ctx,
      argsOf(call, 1, READ_MESSAGES.limit)[0] ?? call,
      READ_MESSAGES.limit,
    ),
  }),
};

const chained = (ctx, calls, read) =>
  calls.reduce(
    (sofar, call) => ({ ...sofar, ...CHAINS[call.name](ctx, call, sofar) }),
    read,
  );

const readFind = (ctx, call, rest) => {
  const [filter, projection] = argsOf(call, 2, READ_MESSAGES.find);
  const where = filter ? filterOf(ctx, filter) : null;
  const columns = projection ? projectionOf(ctx, projection) : null;

  return chained(ctx, rest, {
    mode: "rows",
    where,
    columns: columns ?? defaultColumns(ctx.source),
    groupBy: null,
  });
};

const readCount = (ctx, call) => {
  const [filter] = argsOf(call, 1, READ_MESSAGES.countDocuments);

  return {
    mode: "count",
    where: filter ? filterOf(ctx, filter) : null,
    columns: [{ fn: "count", path: "*" }],
    groupBy: null,
    limit: 1,
  };
};

const distinctName = (named, call) => {
  if (!named) {
    return fail(READ_MESSAGES.distinct, call);
  }

  return named.type === "text"
    ? named.value
    : fail(READ_MESSAGES.distinct, named);
};

// distinct gives every value, as Mongo's does, up to what one column of an
// answer holds.
const readDistinct = (ctx, call) => {
  const [named, filter] = argsOf(call, 2, READ_MESSAGES.distinct);
  const { path } = pathOf(ctx, distinctName(named, call), named);

  return {
    mode: "distinct",
    where: filter ? filterOf(ctx, filter) : null,
    columns: [{ path }],
    groupBy: { path },
    limit: MAX_LIMIT,
  };
};

const unwindEntries = (node) => {
  const entries = new Map(node.entries.map((entry) => [entry.key, entry]));
  const unknown = node.entries.find(
    ({ key }) => !["path", "preserveNullAndEmptyArrays"].includes(key),
  );

  if (unknown) {
    fail(READ_MESSAGES.unwindKey(unknown.key), unknown);
  }

  return entries.has("path") ? entries : fail(READ_MESSAGES.unwind, node);
};

const preserveOf = (entry) => {
  if (!entry) {
    return false;
  }

  return entry.value.type === "literal" &&
    typeof entry.value.value === "boolean"
    ? entry.value.value
    : fail(READ_MESSAGES.preserve, entry.value);
};

// $unwind: '$path', or { path: '$path', preserveNullAndEmptyArrays: true }.
const unwindOf = (ctx, node) => {
  if (!isObject(node)) {
    return { ...refOf(ctx, node, "$unwind"), preserve: false };
  }

  const entries = unwindEntries(node);

  return {
    ...refOf(ctx, entries.get("path").value, "$unwind"),
    preserve: preserveOf(entries.get("preserveNullAndEmptyArrays")),
  };
};

const STAGE_READERS = {
  $match: (ctx, entry) => ({ where: filterOf(ctx, entry.value) }),
  $unwind: (ctx, entry, read) => ({
    unwind:
      read.unwind.length < MAX_UNWINDS
        ? [...read.unwind, unwindOf(ctx, entry.value)]
        : fail(READ_MESSAGES.unwinds, entry),
  }),
  $group: (ctx, entry) => ({
    mode: "groups",
    ...groupOf(ctx, entry.value, entry),
  }),
  $project: (ctx, entry) => ({ columns: projectionOf(ctx, entry.value) }),
  $sort: (ctx, entry, read) => ({ orderBy: sortOf(ctx, entry.value, read) }),
  $limit: (ctx, entry) => ({
    limit: limitNode(ctx, entry.value, READ_MESSAGES.stageLimit),
  }),
};

const stageEntry = (stage) => {
  const entry = onlyEntry(stage) ?? fail(READ_MESSAGES.stage, stage);

  return STAGES.has(entry.key)
    ? entry
    : fail(notAllowed(entry.key, READ_MESSAGES.stageNotAllowed), entry);
};

const isInOrder = (key, place, read) =>
  place > read.place || (place === read.place && REPEATED_STAGES.has(key));

const readStage = (ctx) => (read, stage) => {
  const entry = stageEntry(stage);
  const place = STAGES.get(entry.key);

  if (!isInOrder(entry.key, place, read)) {
    fail(READ_MESSAGES.order, entry);
  }

  return { ...read, place, ...STAGE_READERS[entry.key](ctx, entry, read) };
};

const isPipeline = (node) => node.type === "array" && node.items.length > 0;

const stagesOf = (call) => {
  const [stages = call] = argsOf(call, 1, READ_MESSAGES.aggregate);
  const items = isPipeline(stages)
    ? stages.items
    : fail(READ_MESSAGES.aggregate, stages);

  return items.length > MAX_STAGES
    ? fail(READ_MESSAGES.stages, items[MAX_STAGES])
    : items;
};

const readAggregate = (ctx, call) => {
  const read = stagesOf(call).reduce(readStage(ctx), {
    place: -1,
    mode: "rows",
    where: null,
    unwind: [],
    columns: null,
    groupBy: null,
  });

  return { ...read, columns: read.columns ?? defaultColumns(ctx.source) };
};

const METHOD_READERS = new Map([
  ["find", readFind],
  ["aggregate", readAggregate],
  ["countDocuments", readCount],
  ["distinct", readDistinct],
]);

const readCalls = (ctx, [first, ...rest]) => {
  if (first.name !== "find" && rest.length) {
    fail(
      first.name === "aggregate"
        ? READ_MESSAGES.afterFind(rest[0].name)
        : READ_MESSAGES.ends(first.name),
      rest[0],
    );
  }

  return METHOD_READERS.get(first.name)(ctx, first, rest);
};

// ── The query ──

const sourceOf = (vocabulary, node) => {
  if (vocabulary.sources.has(node.name)) {
    return vocabulary.sources.get(node.name);
  }

  throw vocabulary.unavailable.get(node.name);
};

const limitOf = (asked = DEFAULT_LIMIT) => Math.min(asked, MAX_LIMIT);

const checkCells = (ctx, columns, limit, tree) => {
  if (columns.length * limit > MAX_CELLS) {
    fail(READ_MESSAGES.cells(columns.length, limit), ctx.limitAt ?? tree);
  }
};

const isPlainOrder = (orderBy) => Boolean(orderBy) && !orderBy.fn;

const isTimeDescending = (source, orderBy) =>
  isPlainOrder(orderBy) && orderBy.path === source.time && orderBy.desc;

// Rows newest first is the read's own order, written as none.
const orderOf = (source, { mode, orderBy = null }) =>
  mode === "rows" && isTimeDescending(source, orderBy) ? null : orderBy;

const queryOf = (tree, vocabulary) => {
  const source = sourceOf(vocabulary, tree.source);
  const ctx = { source, spans: new Map(), tests: 0 };
  const read = readCalls(ctx, tree.calls);
  const limit = limitOf(read.limit);

  checkCells(ctx, read.columns, limit, tree);

  const query = {
    v: Math.max(...QUERY_VERSIONS),
    source: source.name,
    mode: read.mode,
    columns: read.columns,
    where: read.where,
    unwind: read.unwind ?? [],
    groupBy: read.groupBy,
    orderBy: orderOf(source, read),
    limit,
    positions: null,
  };

  return {
    query,
    source,
    spans: { tests: ctx.spans, sort: ctx.sortAt ?? null },
  };
};

// The literal tree and the vocabulary to the Query GAS and Caseworking run,
// with where each test was written, or the first failure as
// { message, at, end }. A source whose service didn't answer throws that
// service's failure.
export const readLiteral = (tree, vocabulary) => {
  try {
    return queryOf(tree, vocabulary);
  } catch (error) {
    if (!(error instanceof ReadError)) {
      throw error;
    }

    return { error: { message: error.message, at: error.at, end: error.end } };
  }
};
