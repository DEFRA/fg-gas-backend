import {
  accumulate,
  cellOf,
  dateOf,
  expressionOf,
  groupKeyOf,
  orderValueOf,
  orderedExpressionOf,
  orderedOf,
  sentPartial,
  unwindDoc,
  valueAt,
  valuesOf,
} from "./evaluate.js";

// A column's expression as text: `clientRef`, `count(phases.answers.parcels)`,
// `count(*)`.
export const exprKey = ({ fn, path }) => (fn ? `${fn}(${path})` : path);

// Each column's key: generated, never a name typed, so no name can be one
// an object inherits.
export const columnKeys = (columns) => columns.map((_, n) => `c${n}`);

const isStar = ({ path }) => path === "*";

const readerOfExpr = (readerOf, expr) => (isStar(expr) ? null : readerOf(expr));

const cellMaker = (readerOf, column) => {
  const reader = readerOfExpr(readerOf, column);

  return column.fn
    ? (doc, ctx) => expressionOf(column.fn, doc, reader, ctx)
    : (doc, ctx) => cellOf(doc, reader, ctx);
};

// What a row sorts by, typed, so a merge compares it as the read did.
const orderMaker = (readerOf, orderBy) => {
  if (!orderBy) {
    return () => null;
  }

  const reader = readerOfExpr(readerOf, orderBy);

  return orderBy.fn
    ? (doc, ctx) => orderedExpressionOf(orderBy.fn, doc, reader, ctx)
    : (doc, ctx) => orderValueOf(doc, reader, orderBy.desc, ctx);
};

const timeOf = (doc, timeNames) =>
  dateOf(
    timeNames.reduce((value, name) => value?.[name], doc),
  )?.toISOString() ?? null;

// Turns one record into a row: its key in time order, what it opens, its
// cells by column key, and what it sorts by.
export const rowMaker = ({ query, readerOf, open, timeNames }) => {
  const keys = columnKeys(query.columns);
  const cells = query.columns.map((column) => cellMaker(readerOf, column));
  const order = orderMaker(readerOf, query.orderBy);

  return (doc, ctx) => ({
    key: { t: timeOf(doc, timeNames), i: String(doc._id) },
    open: open(doc, ctx),
    cells: Object.fromEntries(keys.map((key, n) => [key, cells[n](doc, ctx)])),
    order: order(doc, ctx),
  });
};

const aggregatesOf = ({ columns, orderBy }) => {
  const exprs = [...columns, ...(orderBy?.fn ? [orderBy] : [])].filter(
    ({ fn }) => fn,
  );

  return [...new Map(exprs.map((expr) => [exprKey(expr), expr])).entries()];
};

// distinct lists the values a filter finds, as Mongo's does: a list's
// elements, nothing for a missing path.
const distinctValues = (doc, reader, ctx) => valuesOf(doc, reader, ctx);

// A group is the record's whole value at the path; a missing path is (none).
const groupValues = (doc, reader, ctx) => [valueAt(doc, reader, ctx) ?? null];

const valueOfExpr = (reader, doc, ctx) =>
  reader === null ? undefined : valueAt(doc, reader, ctx);

const addTo = (group, doc, aggregates, ctx) => {
  group.n += 1;
  aggregates.forEach(([key, { fn, reader }]) => {
    group.raw[key] = accumulate(
      fn,
      group.raw[key],
      valueOfExpr(reader, doc, ctx),
    );
  });
};

// A group as it is sent: its value and aggregates typed, shown only once
// every part is merged.
const sentGroup =
  (aggregates) =>
  ({ raw, ...group }) => ({
    ...group,
    aggs: Object.fromEntries(
      Object.entries(raw).map(([key, value]) => [
        key,
        sentPartial(aggregates.get(key).fn, value),
      ]),
    ),
  });

// Counts records into groups as they are read: one per whole value at the
// grouped path, or for distinct one per value a filter finds there.
export const grouper = ({ query, readerOf }) => {
  const reader = readerOf(query.groupBy);
  const aggregates = aggregatesOf(query).map(([key, expr]) => [
    key,
    { fn: expr.fn, reader: readerOfExpr(readerOf, expr) },
  ]);
  const byKey = new Map(aggregates);
  const valuesFor = query.mode === "distinct" ? distinctValues : groupValues;
  const groups = new Map();

  const groupOf = (value) => {
    const key = groupKeyOf(value);
    const id = JSON.stringify(key);

    if (!groups.has(id)) {
      groups.set(id, { key, value: orderedOf(value), n: 0, raw: {} });
    }

    return groups.get(id);
  };

  return {
    add: (doc, ctx) =>
      valuesFor(doc, reader, ctx).forEach((value) =>
        addTo(groupOf(value), doc, aggregates, ctx),
      ),
    size: () => groups.size,
    groups: () => [...groups.values()].map(sentGroup(byKey)),
  };
};

// The rows a Query's $unwind stages make of one record, one at a time, so
// each can be charged before the next is made.
export const unwinder = ({ query, readerOf }) => {
  const steps = (query.unwind ?? []).map(({ path, preserve }) => ({
    names: readerOf({ path }).names,
    preserve,
  }));

  const expand = function* (doc, at) {
    if (at === steps.length) {
      yield doc;

      return;
    }

    for (const one of unwindDoc(doc, steps[at])) {
      yield* expand(one, at + 1);
    }
  };

  return (doc) => expand(doc, 0);
};
