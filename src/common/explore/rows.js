import { BSON } from "mongodb";
import {
  SIZE_ERROR,
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
import { promotedOf } from "./evaluate-read.js";
import { SIZE_KEY } from "./fields.js";
import { refusalOf } from "./refusal.js";

// A column's expression as text: `clientRef`, `count(phases.answers.parcels)`,
// `count(*)`.
export const exprKey = ({ fn, path }) => (fn ? `${fn}(${path})` : path);

// Each column's key: generated, never a name typed, so no name can be one
// an object inherits.
export const columnKeys = (columns) => columns.map((_, n) => `c${n}`);

const isStar = ({ path }) => path === "*";

const readerOfExpr = (readerOf, expr) => (isStar(expr) ? null : readerOf(expr));

// A cell mongod's expression fails on fails the query, naming its column.
const inColumn = (make, n) => (doc, ctx) => {
  try {
    return make(doc, ctx);
  } catch (error) {
    if (refusalOf(error) === SIZE_ERROR) {
      error.detail = { ...error.detail, column: n };
    }

    throw error;
  }
};

const cellMaker = (readerOf, column, n) => {
  const reader = readerOfExpr(readerOf, column);

  return inColumn(
    column.fn
      ? (doc, ctx) => expressionOf(column.fn, doc, reader, ctx)
      : (doc, ctx) => cellOf(doc, reader, ctx),
    n,
  );
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

// A record's `_id` as the BSON of { _id }, its type kept.
export const idOf = (doc) =>
  BSON.serialize({ _id: doc._id }).toString("base64");

const sizeOf = (doc) =>
  Object.hasOwn(doc, SIZE_KEY) ? Number(promotedOf(doc[SIZE_KEY])) : null;

// Turns one record into a row: its key in time order, what it opens, what
// it sorts by, with documents its typed `_id`, unwind positions and size,
// and how its cells are made. Cells are made only for the rows an answer
// keeps (withCells), as mongod works out a projection only for what it
// returns.
export const rowMaker = ({ query, readerOf, open, timeNames }) => {
  const keys = columnKeys(query.columns);
  const cells = query.columns.map((column, n) =>
    cellMaker(readerOf, column, n),
  );
  const order = orderMaker(readerOf, query.orderBy);

  const fetchedBy = query.documents
    ? (doc, at) => ({ id: idOf(doc), at, size: sizeOf(doc) })
    : () => ({});

  return (doc, ctx, at = []) => ({
    key: { t: timeOf(doc, timeNames), i: String(doc._id) },
    open: open(doc, ctx),
    order: order(doc, ctx),
    ...fetchedBy(doc, at),
    cells: () =>
      Object.fromEntries(keys.map((key, n) => [key, cells[n](doc, ctx)])),
  });
};

// A kept row with its cells made.
export const withCells = (row) =>
  typeof row.cells === "function" ? { ...row, cells: row.cells() } : row;

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
// each can be charged before the next is made, each with its positions:
// the element's index at each step, null where none was a list's element,
// as mongod's includeArrayIndex gives them.
export const unwinder = ({ query, readerOf }) => {
  const steps = (query.unwind ?? []).map(({ path, preserve }) => ({
    names: readerOf({ path }).names,
    preserve,
  }));

  const expand = function* (doc, step, at) {
    if (step === steps.length) {
      yield { doc, at };

      return;
    }

    for (const [one, index] of unwindDoc(doc, steps[step])) {
      yield* expand(one, step + 1, [...at, index]);
    }
  };

  return (doc) => expand(doc, 0, []);
};
