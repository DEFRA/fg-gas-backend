import { isDollarSegment } from "../../../common/explore/paths.js";
import {
  MAX_COLUMNS,
  MAX_LIMIT,
  MAX_UNWINDS,
  QUERY_VERSION,
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
const ID = "_id";

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

// mongod can't project a key starting $: a projection, an expression and an
// unwind name its parent instead.
const projectable = ({ path }, node) => {
  const names = path.split(".");
  const at = names.findIndex(isDollarSegment);

  return at === -1
    ? { path }
    : fail(
        READ_MESSAGES.dollarKey(names[at], names.slice(0, at).join(".")),
        node,
      );
};

const projectedRef = (node, what) => projectable(refOf(node, what), node);

const expressionColumn = (entry) => {
  const inner = onlyEntry(entry.value);
  const fn = inner ? EXPRESSIONS.get(inner.key) : undefined;

  if (!fn) {
    fail(READ_MESSAGES.show, entry);
  }

  const { path } = projectedRef(inner.value, inner.key);

  return { fn, path, as: checkName(entry) };
};

const projectedColumn = (entry) => {
  if (isOne(entry.value)) {
    return projectable(pathOf(entry.key, entry), entry);
  }

  if (entry.key === ID) {
    fail(READ_MESSAGES.ownId, entry);
  }

  if (isRef(entry.value)) {
    return {
      ...projectedRef(entry.value, entry.key),
      as: checkName(entry),
    };
  }

  return expressionColumn(entry);
};

const columnOfEntry = (entry) => {
  if (!isZero(entry.value)) {
    return [projectedColumn(entry), entry];
  }

  return entry.key === ID ? null : fail(READ_MESSAGES.zero, entry);
};

const checkColumns = (pairs) => {
  if (pairs.length > MAX_COLUMNS) {
    fail(READ_MESSAGES.columns, pairs[MAX_COLUMNS][1]);
  }

  return pairs.map(([column]) => column);
};

// The name a column takes in a projected record: its own name, else its
// path.
const keyOfColumn = ({ path, as }) => as ?? path;

const isWithin = (shorter, longer) => longer.startsWith(`${shorter}.`);

// Two columns where one names a key inside the other, as mongod refuses
// them: `a` with `a.b`, or a name with a path below it.
const checkCollisions = (pairs) =>
  pairs.forEach(([column, entry], n) =>
    pairs.slice(0, n).forEach(([other]) => {
      const [a, b] = [keyOfColumn(other), keyOfColumn(column)];
      const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];

      if (isWithin(shorter, longer)) {
        fail(READ_MESSAGES.collision(shorter, longer), entry);
      }
    }),
  );

// `_id` is the first column, as mongod puts it first.
const idFirst = (pairs) => [
  ...pairs.filter(([column]) => column.path === ID && !column.as),
  ...pairs.filter(([column]) => column.path !== ID || column.as),
];

// A projection to columns: null when it names none, for the defaults.
// `_id: 0` alone shows the defaults too.
const projectionOf = (node) => {
  if (!isObject(node)) {
    fail(READ_MESSAGES.fields, node);
  }

  const pairs = node.entries.map(columnOfEntry).filter(Boolean);

  checkCollisions(pairs);

  return pairs.length ? checkColumns(idFirst(pairs)) : null;
};

const defaultColumns = (source) => source.star.map((path) => ({ path }));

// ── $group ──

const summed = (node) => ({
  fn: "sum",
  ...projectedRef(node, "$sum"),
});

// $sum: 1 counts; any other number is refused, as summing it is no answer.
const sumColumn = (_ctx, inner) => {
  if (isNumber(inner.value, 1)) {
    return { fn: "count", path: "*" };
  }

  return inner.value.type === "number"
    ? fail(READ_MESSAGES.sumOne, inner.value)
    : summed(inner.value);
};

const ACCUMULATOR_COLUMNS = {
  sum: sumColumn,
  count: (_ctx, inner) =>
    isObject(inner.value) && !inner.value.entries.length
      ? { fn: "count", path: "*" }
      : fail(READ_MESSAGES.count, inner.value),
  min: (_ctx, inner) => ({
    fn: "min",
    ...projectedRef(inner.value, "$min"),
  }),
  max: (_ctx, inner) => ({
    fn: "max",
    ...projectedRef(inner.value, "$max"),
  }),
};

const accumulatorColumn = (ctx) => (entry) => {
  const inner = onlyEntry(entry.value);
  const fn = inner ? ACCUMULATORS.get(inner.key) : undefined;

  return fn
    ? [{ ...ACCUMULATOR_COLUMNS[fn](ctx, inner), as: checkName(entry) }, entry]
    : fail(READ_MESSAGES.work(entry.key), entry);
};

// `_id` keeps its meaning here: the path to group by.
const groupOf = (ctx, node, stage) => {
  if (!isObject(node)) {
    fail(READ_MESSAGES.group, node);
  }

  const id = node.entries.find(({ key }) => key === ID);
  const { path } = id
    ? refOf(id.value, ID)
    : fail(READ_MESSAGES.groupId, stage);
  const accumulators = node.entries
    .filter((entry) => entry !== id)
    .map(accumulatorColumn(ctx));

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
  [ID, path].includes(entry.key)
    ? { path, fn: null }
    : fail(READ_MESSAGES.sortGroups, entry);

// A sort key is a column's name, else the group's path, else a path.
const sortKeyOf = (entry, read) => {
  const named = (read.columns ?? []).find(({ as }) => as === entry.key);

  if (named) {
    return keyOf(named);
  }

  return read.groupBy
    ? groupSortKey(entry, read.groupBy)
    : { ...pathOf(entry.key, entry), fn: null };
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

  return { ...sortKeyOf(entry, read), desc };
};

const isPositiveInteger = (node) =>
  node.type === "number" && Number.isInteger(node.value) && node.value >= 1;

const limitNode = (ctx, node, message) => {
  ctx.limitAt = node;

  if (!isPositiveInteger(node)) {
    fail(message, node);
  }

  return node.value > MAX_LIMIT
    ? fail(READ_MESSAGES.limitMost, node)
    : node.value;
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
  const columns = projection ? projectionOf(projection) : null;

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
  const { path } = pathOf(distinctName(named, call), named);

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
const unwindOf = (node) => {
  if (!isObject(node)) {
    return { ...projectedRef(node, "$unwind"), preserve: false };
  }

  const entries = unwindEntries(node);

  return {
    ...projectedRef(entries.get("path").value, "$unwind"),
    preserve: preserveOf(entries.get("preserveNullAndEmptyArrays")),
  };
};

const STAGE_READERS = {
  $match: (ctx, entry) => ({ where: filterOf(ctx, entry.value) }),
  $unwind: (_ctx, entry, read) => ({
    unwind:
      read.unwind.length < MAX_UNWINDS
        ? [...read.unwind, unwindOf(entry.value)]
        : fail(READ_MESSAGES.unwinds, entry),
  }),
  $group: (ctx, entry) => ({
    mode: "groups",
    ...groupOf(ctx, entry.value, entry),
  }),
  $project: (_ctx, entry) => ({ columns: projectionOf(entry.value) }),
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
  const limit = read.limit ?? DEFAULT_LIMIT;

  checkCells(ctx, read.columns, limit, tree);

  const query = {
    v: QUERY_VERSION,
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
