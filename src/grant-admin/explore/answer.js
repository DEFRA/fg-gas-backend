import { COUNT_CAP } from "../../common/buckets/engine.js";
import {
  compareKeys,
  encodePositions,
  mergeExact,
  mergeGroups,
  mergeWindowed,
  windowEnding,
} from "../../common/explore/merge.js";
import {
  compareBson,
  isDateText,
  orderedValue,
  partialValue,
  shownOrdered,
  shownPartial,
} from "../../common/explore/evaluate.js";
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

// Each column's key, its header, what its values are and whether it is an
// aggregate.
export const columnsOf = (query, rows) => {
  const keys = columnKeys(query.columns);

  return query.columns.map((column, n) => ({
    key: keys[n],
    label: labelOf(query, column),
    kind: kindOf(valuesIn(rows, keys[n])),
    aggregate: Boolean(column.fn),
  }));
};

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

const groupRow = (query, keys) => (group) => ({
  open: null,
  cells: Object.fromEntries(
    query.columns.map((column, n) => [keys[n], groupCell(group, column)]),
  ),
});

const groupRows = (query, groups) =>
  groups
    .slice()
    .sort(compareGroups(groupOrder(query)))
    .slice(0, query.limit)
    .map(groupRow(query, columnKeys(query.columns)));

// ── Rows ──

const plainRow = ({ open, cells }) => ({ open, cells });

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

const NOT_ENDED = { partial: false, skipped: 0 };

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

const rowsOf = (query, read, boxes) => {
  if (read !== "windowed") {
    return { rows: mergeExact(boxes, query).rows, window: null };
  }

  const merged = mergeWindowed(boxes, query);

  return {
    rows: merged.rows,
    window: windowOf(merged),
    ending: windowEnding(boxes, merged.cut),
  };
};

const groupedRows = (query, parts) => {
  const groups = mergeGroups(parts.map((part) => part.groups ?? []));

  return {
    rows: groupRows(query, groups),
    window: null,
    groups: groups.length,
    ending: NOT_ENDED,
  };
};

// A CSV's rows come merged, its window saying what it skipped.
const csvEnding = (merged) => ({
  partial: false,
  skipped: merged.window.skipped ?? 0,
});

const listedRows = (query, read, boxes, merged) => {
  const listed = merged
    ? { ...merged, ending: csvEnding(merged) }
    : rowsOf(query, read, boxes);

  return {
    rows: listed.rows.map(plainRow),
    window: listed.window,
    ending: listed.ending ?? NOT_ENDED,
  };
};

// A count the engine capped is at least what it counted.
const countCell = ({ n, capped }) =>
  capped ? `${n.toLocaleString("en-GB")}+` : n;

const countedRows = (query, boxes) => ({
  rows: [
    {
      open: null,
      cells: { [columnKeys(query.columns)[0]]: countCell(sumCounts(boxes)) },
    },
  ],
  window: null,
  ending: NOT_ENDED,
});

const rowsFor = (query, read, boxes, { parts, merged }) => {
  if (query.mode === "count") {
    return countedRows(query, boxes);
  }

  return query.groupBy
    ? groupedRows(query, parts)
    : listedRows(query, read, boxes, merged);
};

// The parts each service read, as one answer: rows merged in order, groups
// or distinct values merged and sorted, or one count, with the count line's
// figures. `merged` gives rows already merged, as a CSV's windows are.
export const answerFrom = ({
  source,
  query,
  parts,
  merged,
  partial = false,
}) => {
  const read = readOf(parts);
  const boxes = parts.flatMap((part) => part.boxes);
  const { rows, window, groups, ending } = rowsFor(query, read, boxes, {
    parts,
    merged,
  });

  return {
    source: { name: source.name, noun: source.noun.one },
    mode: query.mode,
    read,
    columns: columnsOf(query, rows),
    rows,
    count: countOf(read, boxes, groups),
    groups: Boolean(query.groupBy),
    unwound: query.unwind.length > 0,
    // Ended early, out of work: the rows are those found back to window.to;
    // skipped counts records there too large to search.
    partial: partial || ending.partial,
    window: window && { ...window, skipped: ending.skipped },
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
