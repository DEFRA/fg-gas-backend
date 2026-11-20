import Boom from "@hapi/boom";
import { COUNT_CAP } from "../../../common/buckets/engine.js";
import { PAGE_SIZE } from "../../../common/buckets/schema.js";
import {
  compareKeys,
  mergeWindowed,
  windowEnding,
} from "../../../common/explore/merge.js";
import { encodeCursor } from "../../../common/buckets/cursor.js";
import { encodeGroupCursor, parseCursorText } from "./cursor.js";

const union = (lists) => [...new Set(lists.flat())];

// A failed read names its queue, and the others are stopped: a page shows
// every member's rows or none.
const withQueue = (error, value) => {
  const failure = error.isBoom ? error : Boom.boomify(error);

  failure.output.payload.queue = value;

  return failure;
};

const readAll = (reading, read) => {
  const controller = new AbortController();

  return Promise.all(
    reading.map(async (member) => {
      try {
        return await read(member, controller.signal);
      } catch (error) {
        controller.abort();
        throw withQueue(error, member.value);
      }
    }),
  );
};

// A box as Explore's merge reads a window: one that has more ends at its last
// row, one that read bounded at its edge, and one that is complete ends.
const toBox = (member, { rows, page }) => {
  const keyed = rows.map((row) => ({
    ...row,
    key: { t: row.time, i: row.id },
  }));
  const box = { id: member.bucket, value: member.value, rows: keyed };

  if (page.next !== null) {
    return { ...box, to: keyed.at(-1).key, end: false, partial: false };
  }

  return page.keepLooking === null
    ? { ...box, to: null, end: true, partial: false }
    : {
        ...box,
        to: parseCursorText(page.keepLooking),
        end: false,
        partial: true,
      };
};

const isCut = (cut) => (box) =>
  box.partial && box.to.t === cut.t && box.to.i === cut.i && box.id === cut.box;

const holdsPast = (cut) => (box) =>
  box.rows.some((row) => compareKeys({ ...row.key, box: box.id }, cut) > 0);

// Which bounded queues ended the page, and which others have read rows that
// wait behind them.
const queuesOf = (boxes, cut) => {
  const limited = boxes.filter(isCut(cut));
  const waiting = boxes
    .filter((box) => !limited.includes(box))
    .filter(holdsPast(cut));

  return {
    limited: limited.map(({ value }) => value),
    waiting: waiting.map(({ value }) => value),
  };
};

const NONE_WAITING = { limited: [], waiting: [] };

const ended = {
  next: null,
  keepLooking: null,
  searchedTo: null,
  complete: true,
};

const pageOf = (boxes, merged, cursor) => {
  if (Object.values(cursor.positions).every((position) => position === null)) {
    return { page: ended, queues: NONE_WAITING };
  }

  const next = encodeGroupCursor(cursor);

  return windowEnding(boxes, merged.cut).partial
    ? {
        page: {
          next: null,
          keepLooking: next,
          searchedTo: merged.cut.t,
          complete: false,
        },
        queues: queuesOf(boxes, merged.cut),
      }
    : {
        page: { next, keepLooking: null, searchedTo: null, complete: false },
        queues: NONE_WAITING,
      };
};

// A part counted from a bounded plan has no total, so neither has the list;
// a part capped means the sum is past the cap too.
const totalOf = (totals) => {
  if (totals.some((total) => total === null || total === undefined)) {
    return null;
  }

  return totals.some(({ capped }) => capped)
    ? { count: COUNT_CAP, capped: true }
    : {
        count: totals.reduce((sum, { count }) => sum + count, 0),
        capped: false,
      };
};

// Bounded once any member has read bounded on this walk, even one that has
// since ended.
const planOf = (answers, bounded) => ({
  kind: bounded.length > 0 ? "bounded" : "exact",
  index: [],
  bound: union(answers.map(({ plan }) => plan.bound)),
  filled: union(answers.map(({ plan }) => plan.filled)),
  residual: union(answers.map(({ plan }) => plan.residual)),
  scans: Math.max(
    1,
    answers.reduce((sum, { plan }) => sum + plan.scans, 0),
  ),
});

// Each row as the list draws it, its member's value in the pick's own cell.
const toRow =
  (boxes, pick) =>
  ({ key: _key, box, ...row }) => ({
    ...row,
    cells: {
      ...row.cells,
      [pick.name]: boxes.find(({ id }) => id === box).value,
    },
  });

const cursorOf = (start, { bucket }) =>
  start === null ? undefined : encodeCursor(start.positions[bucket]);

// One page of a group: each member read from its own position, in parallel,
// and merged newest first. `start` is null on a first page; a member whose
// position is null has shown all its rows.
export const readGroupPage = async ({
  bucket,
  pick,
  reading,
  start,
  count,
  read,
}) => {
  const live = reading.filter(
    ({ bucket: id }) => start === null || start.positions[id] !== null,
  );
  const answers = await readAll(live, (member, signal) =>
    read(member, { cursor: cursorOf(start, member), count, signal }),
  );
  const boxes = live.map((member, i) => toBox(member, answers[i]));
  const merged = mergeWindowed(boxes, { limit: PAGE_SIZE });
  const cursor = {
    positions: Object.fromEntries(
      reading.map(({ bucket: id }) => [id, merged.positions[id] ?? null]),
    ),
    bounded: union([
      start?.bounded ?? [],
      live
        .filter((_, i) => answers[i].plan.kind === "bounded")
        .map(({ bucket: id }) => id),
    ]),
  };

  return {
    bucket,
    plan: planOf(answers, cursor.bounded),
    rows: merged.rows.map(toRow(boxes, pick)),
    ...pageOf(boxes, merged, cursor),
    groups: [],
    ...(count && { total: totalOf(answers.map(({ total }) => total)) }),
  };
};

// What a group answers when its address rules out every member.
export const noMembersPage = ({ bucket, count }) => ({
  bucket,
  plan: planOf([], []),
  rows: [],
  page: ended,
  groups: [],
  ...(count && { total: { count: 0, capped: false } }),
  queues: NONE_WAITING,
});
