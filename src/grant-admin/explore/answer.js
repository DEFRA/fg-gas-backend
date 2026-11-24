import { BSON } from "mongodb";
import { COUNT_CAP } from "../../common/buckets/engine.js";
import {
  bsonValueOf,
  compareBson,
  isDateText,
  orderedValue,
  partialValue,
  shownOrdered,
  shownPartial,
} from "../../common/explore/evaluate.js";
import {
  cellsAllowanceOf,
  costOfAll,
  fittingCount,
  groupCostOf,
  isWithin,
  rowCostOf,
} from "../../common/explore/cells-allowance.js";
import {
  compareKeys,
  compareRows,
  encodePositions,
  mergeExact,
  mergeGroups,
  mergeWindowed,
  windowEnding,
} from "../../common/explore/merge.js";
import { rowCapOf } from "../../common/explore/query-schema.js";
import { refuseQuery } from "../../common/explore/refusal.js";
import { pathsOfQuery } from "../../common/explore/fields.js";
import { columnKeys, exprKey } from "../../common/explore/rows.js";

const NONE = "(none)";

const valuesIn = (rows, key) =>
  rows.flatMap(({ cells }) => [cells[key] ?? []].flat());

const KINDS = [
  ["number", (value) => typeof value === "number"],
  ["date", isDateText],
];

// What a column holds, as its values say: numbers, dates (stored as dates or
// as ISO text), or text.
const kindOf = (values) => {
  const [kind = "text"] =
    KINDS.find(
      ([, holds]) => values.length > 0 && values.every((value) => holds(value)),
    ) ?? [];

  return kind;
};

// A column is headed by the name the query gives it, else its path.
const labelOf = (query, column) => {
  if (query.mode === "count") {
    return "count";
  }

  return column.as ?? column.path;
};

// The stored path a plain path's column shows; null for a name, a worked
// out value, a group or a count.
const pathOfColumn = (query, column) =>
  query.mode === "rows" && !column.fn && column.as === undefined
    ? column.path
    : null;

// Each column's key, its header, what its values are, whether it is an
// aggregate and the path it shows.
export const columnsOf = (query, rows) => {
  const keys = columnKeys(query.columns);

  return query.columns.map((column, n) => ({
    key: keys[n],
    label: labelOf(query, column),
    kind: kindOf(valuesIn(rows, keys[n])),
    aggregate: Boolean(column.fn),
    path: pathOfColumn(query, column),
  }));
};

// The most rows one answer holds for these columns, and how a person asks
// for more: `.limit(n)` in a find, a `$limit` stage in an aggregate; null
// where they can't.
export const limitsOf = (query, raise) => ({
  rows: rowCapOf(query.columns),
  raise,
});

// ── Groups ──

// Groups come most first, distinct values in their order, unless sorted:
// by their typed values, shown only after.
const valueOfGroup = (group) => orderedValue(group.value);

const unsorted = (query) =>
  query.mode === "distinct"
    ? { desc: false, value: valueOfGroup }
    : { desc: true, value: (group) => group.n };

const groupOrder = (query) => {
  const { orderBy } = query;

  if (orderBy?.fn) {
    const key = exprKey(orderBy);

    return {
      desc: orderBy.desc,
      value: (group) => partialValue(orderBy.fn, group.aggs[key]),
    };
  }

  return orderBy
    ? { desc: orderBy.desc, value: valueOfGroup }
    : unsorted(query);
};

// Mongo's full order, null lowest, as rows are sorted.
const compareGroups =
  ({ desc, value }) =>
  (a, b) =>
    desc ? compareBson(value(b), value(a)) : compareBson(value(a), value(b));

const groupCell = (group, column) =>
  column.fn
    ? shownPartial(column.fn, group.aggs[exprKey(column)])
    : (shownOrdered(group.value) ?? NONE);

const bsonOf = (entries) => BSON.serialize(new Map(entries)).toString("base64");

// A group as mongod's $group gives it, { _id, <name>: <aggregate>, … }, a
// distinct value as { v }, each typed as mongod's would be.
const groupDocOf = (query, group) => {
  const value = bsonValueOf(group.value);

  if (query.mode === "distinct") {
    return bsonOf([["v", value]]);
  }

  return bsonOf([
    ["_id", value],
    ...query.columns
      .filter(({ fn }) => fn)
      .map((column) => [
        column.as,
        partialValue(column.fn, group.aggs[exprKey(column)]),
      ]),
  ]);
};

const workedOutDoc = (doc) => ({
  id: null,
  at: null,
  doc,
  context: null,
  docNote: null,
});

const groupRow = (query, keys) => (group) => ({
  open: null,
  cells: Object.fromEntries(
    query.columns.map((column, n) => [keys[n], groupCell(group, column)]),
  ),
  ...(query.documents && workedOutDoc(groupDocOf(query, group))),
});

const cellsTooLarge = () => refuseQuery("CELLS_TOO_LARGE");

const checkCost = (cost, allowance) => {
  if (!isWithin(cost, allowance)) {
    throw cellsTooLarge();
  }
};

// Groups' values travel whole, held; what they draw is their rows'.
const groupRows = (query, groups, allowance) => {
  const shown = groups
    .slice()
    .sort(compareGroups(groupOrder(query)))
    .slice(0, query.limit);
  const rows = shown.map(groupRow(query, columnKeys(query.columns)));

  checkCost(
    {
      drawn: costOfAll(rows, rowCostOf).drawn,
      held: costOfAll(shown, groupCostOf).held,
    },
    allowance,
  );

  return rows;
};

// ── Rows ──

// With documents, a row keeps what its document is fetched by until it is.
const plainRow =
  (query) =>
  ({ open, cells, box, id, at, size }) => ({
    open,
    cells,
    ...(query.documents && { fetch: { box, id, at, size } }),
  });

// Each box counts up to the cap: boxes that reached it say only that there
// are at least that many, not the sum of their caps.
const sumCounts = (boxes) => {
  const counts = boxes.map(({ count }) => count).filter(Boolean);
  const capped = counts.some((count) => count.capped);

  return {
    n: capped ? COUNT_CAP : counts.reduce((total, { n }) => total + n, 0),
    capped,
  };
};

const NOT_ENDED = { partial: false, skipped: [] };

const windowOf = (merged) => ({
  to: merged.to,
  end: merged.end,
  positions: merged.end ? null : encodePositions(merged.positions),
});

// No part at all is an exact read of nothing.
// A grouped answer also counts its groups, all of them, however many LIMIT shows.
const countOf = (read, boxes, groups) => {
  if (read === "windowed") {
    return null;
  }

  return groups === undefined
    ? sumCounts(boxes)
    : { ...sumCounts(boxes), groups };
};

const readOf = (parts) => {
  if (parts.some(({ read }) => read === "windowed")) {
    return "windowed";
  }

  return parts.length ? parts[0].read : "exact";
};

const cutsOf = (parts) => parts.map(({ cutAfter }) => cutAfter).filter(Boolean);

// A part cut at its cells allowance holds no row past its `cutAfter`, so
// no other part's row past it is kept either: the rows shown have no gap.
const isWithinCuts = (cuts, orderBy) => {
  const order = compareRows(orderBy);

  return ({ key, box, order: value }) =>
    cuts.every(
      (cut) => order({ key: { ...key, box }, order: value }, cut) <= 0,
    );
};

// The cells of an exact read's rows are held to the allowance: past it the
// read is refused, or, for a download (`cut`), ends at the last whole row,
// and at the earliest any part was cut. A part's cut ended the download
// unless as many rows as it shows come before it.
const exactRows = (rows, { allowance, cut, parts, query }) => {
  if (cut) {
    const cuts = cutsOf(parts);
    const read = rows.filter(isWithinCuts(cuts, query.orderBy));
    const kept = read.slice(0, fittingCount(read, allowance));

    return {
      rows: kept,
      cutAtBytes: kept.length < (cuts.length ? query.limit : rows.length),
    };
  }

  checkCost(costOfAll(rows, rowCostOf), allowance);

  return { rows, cutAtBytes: false };
};

// A windowed read's merged rows whose cells don't fit end there, as a
// limit would end them.
const windowedRows = (query, boxes, allowance) => {
  const merged = mergeWindowed(boxes, query);
  const fit = fittingCount(merged.rows, allowance);

  return fit < merged.rows.length
    ? { merged: mergeWindowed(boxes, { ...query, limit: fit }), short: true }
    : { merged, short: false };
};

const endingOf = (boxes, { merged, short }) => {
  const ending = windowEnding(boxes, merged.cut);

  return { ...ending, partial: ending.partial || short };
};

// The cells of the rows shown are held to the allowance left: a windowed
// read ends early within it.
const rowsOf = (query, read, boxes, { parts, allowance, cut }) => {
  if (read !== "windowed") {
    return {
      ...exactRows(mergeExact(boxes, query).rows, {
        allowance,
        cut,
        parts,
        query,
      }),
      window: null,
    };
  }

  const windowed = windowedRows(query, boxes, allowance);

  return {
    rows: windowed.merged.rows,
    window: windowOf(windowed.merged),
    ending: endingOf(boxes, windowed),
    cutAtBytes: windowed.short,
  };
};

// The oldest time a download's rows reach, as far as it searched.
const oldestOf = (rows) =>
  rows
    .map(({ key }) => key?.t ?? null)
    .filter(Boolean)
    .sort()[0] ?? null;

const groupedRows = (query, parts, allowance) => {
  const groups = mergeGroups(parts.map((part) => part.groups ?? []));

  return {
    rows: groupRows(query, groups, allowance),
    window: null,
    groups: groups.length,
    ending: NOT_ENDED,
  };
};

// A CSV's rows come merged, its window saying what it skipped.
const csvEnding = (merged) => ({
  partial: false,
  skipped: merged.window.skipped ?? [],
});

const listedRows = (query, read, boxes, { parts, merged, allowance, cut }) => {
  const listed = merged
    ? { ...merged, ending: csvEnding(merged) }
    : rowsOf(query, read, boxes, { parts, allowance, cut });

  return {
    rows: listed.rows.map(plainRow(query)),
    window: listed.window,
    ending: listed.ending ?? NOT_ENDED,
    cutAtBytes: Boolean(listed.cutAtBytes),
    oldest: oldestOf(listed.rows),
  };
};

// A count the engine capped is at least what it counted.
const countCell = ({ n, capped }) =>
  capped ? `${n.toLocaleString("en-GB")}+` : n;

const countDocOf = ({ n }) => bsonOf([["n", partialValue("count", n)]]);

const countedRows = (query, boxes) => ({
  rows: [
    {
      open: null,
      cells: { [columnKeys(query.columns)[0]]: countCell(sumCounts(boxes)) },
      ...(query.documents && workedOutDoc(countDocOf(sumCounts(boxes)))),
    },
  ],
  window: null,
  ending: NOT_ENDED,
});

const rowsFor = (query, read, boxes, { parts, merged, allowance, cut }) => {
  if (query.mode === "count") {
    return countedRows(query, boxes);
  }

  return query.groupBy
    ? groupedRows(query, parts, allowance)
    : listedRows(query, read, boxes, { parts, merged, allowance, cut });
};

// The parts each service read, as one answer: rows merged in order, groups
// or distinct values merged and sorted, or one count, with the count line's
// figures. `merged` gives rows already merged, as a CSV's windows are.
const ANSWERED = {
  partial: false,
  allowance: cellsAllowanceOf(undefined),
  cut: false,
};

const windowWith = (window, ending) =>
  window && { ...window, skipped: ending.skipped };

const shapeOf = ({ source, query, read, boxes, listed, partial }) => ({
  source: { name: source.name, noun: source.noun.one },
  mode: query.mode,
  read,
  columns: columnsOf(query, listed.rows),
  rows: listed.rows,
  count: countOf(read, boxes, listed.groups),
  groups: Boolean(query.groupBy),
  unwound: query.unwind.length > 0,
  // Ended early, out of work: the rows are those found back to window.to;
  // skipped lists records there too large to search.
  partial: partial || listed.ending.partial,
  window: windowWith(listed.window, listed.ending),
});

export const answerFrom = (asked) => {
  const { source, query, parts, merged, partial, allowance, cut } = {
    ...ANSWERED,
    ...asked,
  };
  const read = readOf(parts);
  const boxes = parts.flatMap((part) => part.boxes);
  const listed = rowsFor(query, read, boxes, { parts, merged, allowance, cut });

  return {
    ...shapeOf({ source, query, read, boxes, listed, partial }),
    ...(cut && { cutAtBytes: listed.cutAtBytes, oldest: listed.oldest }),
  };
};

const isNear = (path) => (known) =>
  known === path ||
  known.startsWith(`${path}.`) ||
  path.startsWith(`${known}.`);

// The paths a query reads that are no suggested path, nor above or below one:
// a path no definition names, which may be mistyped.
export const unseenPaths = (source, query) => {
  const known = [...source.paths.keys()];

  return [...new Set(pathsOfQuery(query))].filter(
    (path) => !known.some(isNear(path)),
  );
};

// Rows no older than where each box's last shown window ended.
export const shownBy = (positions) => (row) => {
  const at = positions[row.box] ?? null;

  return (
    at === null ||
    compareKeys({ ...row.key, box: row.box }, { ...at, box: row.box }) <= 0
  );
};
