import Joi from "joi";
import { compareOrdered, mergePartial } from "./evaluate.js";
import { refuseQuery } from "./refusal.js";

const LOWEST_ID = "0".repeat(24);
const HIGHEST_ID = "f".repeat(24);

const compare = (a, b) => {
  if (a === b) {
    return 0;
  }

  return a < b ? -1 : 1;
};

const nullsLast = (a, b, order) => {
  if (a === null || b === null) {
    return compare(a === null, b === null);
  }

  return order(a, b);
};

// Newest first; at one time, by box, then newest _id first, as each box reads.
export const compareKeys = (a, b) =>
  nullsLast(a.t, b.t, (x, y) => compare(y, x)) ||
  compare(a.box, b.box) ||
  compare(b.i, a.i);

const isDefaultOrder = (orderBy) => orderBy === null;

// Mongo's full order, null and missing lowest: first ascending, last
// descending.
const byOrder =
  ({ desc }) =>
  (a, b) =>
    desc ? compareOrdered(b.order, a.order) : compareOrdered(a.order, b.order);

// Rows in the Query's order. Ties go the order's way, as a box reads them:
// newest first, or oldest first for an ascending order, so a box's first
// rows are always the merge's.
export const compareRows = (orderBy) => {
  if (isDefaultOrder(orderBy)) {
    return (a, b) => compareKeys(a.key, b.key);
  }

  const order = byOrder(orderBy);
  const ties = orderBy.desc
    ? (a, b) => compareKeys(a.key, b.key)
    : (a, b) => compareKeys(b.key, a.key);

  return (a, b) => order(a, b) || ties(a, b);
};

const rowsOf = (boxes) =>
  boxes.flatMap(({ id, rows }) =>
    rows.map((row) => ({ ...row, key: { ...row.key, box: id } })),
  );

const countOf = (boxes) => {
  const counts = boxes.map(({ count }) => count).filter(Boolean);

  return counts.length
    ? {
        n: counts.reduce((total, { n }) => total + n, 0),
        capped: counts.some(({ capped }) => capped),
      }
    : null;
};

const withoutKeyBox = ({ key: { box, ...key }, ...row }) => ({
  ...row,
  key,
  box,
});

// Every box's rows in one order, the first `limit` kept; counts add up.
export const mergeExact = (boxes, { limit, orderBy }) => ({
  rows: rowsOf(boxes)
    .sort(compareRows(orderBy))
    .slice(0, limit)
    .map(withoutKeyBox),
  count: countOf(boxes),
});

const newestEnd = (boxes) =>
  boxes
    .filter(({ end }) => !end)
    .map(({ id, to }) => ({ ...to, box: id }))
    .sort(compareKeys)[0] ?? null;

const tieId = (box, cut) => (box < cut.box ? LOWEST_ID : HIGHEST_ID);

// Where a box goes on from: just after the cut, which another box may have made.
const positionAt = (box, cut) => ({
  t: cut.t,
  i: box === cut.box ? cut.i : tieId(box, cut),
});

const isDone = (box, shown) =>
  box.end && box.rows.every((row) => shown.has(`${box.id}\n${row.key.i}`));

// Windows read apart, merged newest first. A box that read past the newest of
// the others' window ends can't show those rows yet: another box may have
// rows between. Each box goes on from the cut: the last row shown when the
// limit cut the rows, else that newest window end.
export const mergeWindowed = (boxes, { limit }) => {
  const end = newestEnd(boxes);
  const candidates = rowsOf(boxes)
    .sort((a, b) => compareKeys(a.key, b.key))
    .filter((row) => end === null || compareKeys(row.key, end) <= 0);
  const rows = candidates.slice(0, limit);
  const cut = candidates.length > limit ? rows.at(-1).key : end;
  const shown = new Set(rows.map(({ key }) => `${key.box}\n${key.i}`));
  const positions = Object.fromEntries(
    boxes.map((box) => [
      box.id,
      isDone(box, shown) ? null : positionAt(box.id, cut),
    ]),
  );

  return {
    rows: rows.map(withoutKeyBox),
    positions,
    to: cut?.t ?? null,
    end: Object.values(positions).every((position) => position === null),
    cut,
  };
};

const isCutBy = (box, cut) =>
  box.id === cut.box && box.to.t === cut.t && box.to.i === cut.i;

const endsAtCut = (cut) => (box) =>
  cut !== null && !box.end && box.to !== null && isCutBy(box, cut);

// How the shown window ended: partial, and with records skipped as too large
// to search, only where a box's own window end is the cut. A box that ended
// further back goes on from the cut and meets its end again later.
export const windowEnding = (boxes, cut) => {
  const ending = boxes.filter(endsAtCut(cut));

  return {
    partial: ending.some(({ partial }) => partial === true),
    skipped: ending.flatMap(({ skipped = [] }) => skipped),
  };
};

// ── Cut at the cells allowance ──

const isAfter = (row, box, cut) =>
  compareKeys({ ...row.key, box: box.id }, cut) > 0;

// A box whose window holds rows past the cut ends at the last it keeps, as
// a window cut by its limit does, at least one row read: `cut`, as its
// cells allowance ended it, not its work.
const endedAtCut = (cut) => (box) => {
  const kept = box.rows.filter((row) => !isAfter(row, box, cut));

  if (kept.length === box.rows.length) {
    return box;
  }

  const rows = kept.length ? kept : box.rows.slice(0, 1);

  return {
    ...box,
    rows,
    to: rows.at(-1).key,
    end: false,
    count: null,
    partial: true,
    cut: true,
  };
};

// Windowed boxes ended at `cut`, the key of the last row their cells fit
// with: each window ends early, and Keep looking goes on.
export const cutAt = (boxes, cut) => boxes.map(endedAtCut(cut));

// Only the rows an exact read can show: the first `limit` across the boxes,
// in the Query's order. The counts stand.
export const keptExact = (boxes, { limit, orderBy }) => {
  const order = compareRows(orderBy);
  const kept = new Set(
    boxes
      .flatMap(({ id, rows }) =>
        rows.map((row) => ({ ...row, key: { ...row.key, box: id }, row })),
      )
      .sort(order)
      .slice(0, limit)
      .map(({ row }) => row),
  );

  return boxes.map((box) => ({
    ...box,
    rows: box.rows.filter((row) => kept.has(row)),
  }));
};

const fnOf = (aggKey) => aggKey.slice(0, aggKey.indexOf("("));

const mergeAggs = (a, b) =>
  Object.fromEntries(
    Object.keys(b).map((aggKey) => [
      aggKey,
      Object.hasOwn(a, aggKey)
        ? mergePartial(fnOf(aggKey), a[aggKey], b[aggKey])
        : b[aggKey],
    ]),
  );

const mergeGroup = (a, b) => ({
  ...a,
  value: a.value ?? b.value,
  n: a.n + b.n,
  aggs: mergeAggs(a.aggs, b.aggs),
});

// Groups counted apart as one list, in the order first met: counts and sums
// add, the lowest and highest are the extremes.
export const mergeGroups = (lists) => {
  const groups = new Map();

  lists.flat().forEach((group) => {
    const id = JSON.stringify(group.key);

    groups.set(id, groups.has(id) ? mergeGroup(groups.get(id), group) : group);
  });

  return [...groups.values()];
};

const cursorSchema = Joi.object({
  t: Joi.string().isoDate().required(),
  i: Joi.string().hex().length(LOWEST_ID.length).required(),
});

const positionsSchema = Joi.object().pattern(
  /^[a-z]+\.[a-z][a-z0-9-]*$/,
  cursorSchema.allow(null),
);

// Positions travel to the caller as one opaque text, and back.
export const encodePositions = (positions) =>
  Buffer.from(JSON.stringify(positions)).toString("base64url");

const refuseInherited = (key, value) => {
  if (key === "__proto__") {
    throw new TypeError("Positions name an inherited key");
  }

  return value;
};

const parsed = (text) => {
  try {
    return JSON.parse(
      Buffer.from(text, "base64url").toString(),
      refuseInherited,
    );
  } catch {
    return undefined;
  }
};

export const decodePositions = (text) => {
  const { error, value } = positionsSchema
    .required()
    .validate(parsed(String(text)));

  if (error) {
    throw refuseQuery("BAD_POSITION");
  }

  return value;
};
