import { encodeCursor } from "../../common/buckets/cursor.js";
import {
  compareKeys,
  encodePositions,
  mergeWindowed,
  windowEnding,
} from "../../common/explore/merge.js";
import { MAX_CELLS, MAX_LIMIT } from "../../common/explore/query-schema.js";
import { refusalOf } from "../../common/explore/refusal.js";
import { shownBy } from "./answer.js";
import { partsOf } from "./federate.js";
import { readInTurn, skippedIn } from "./windows.js";

// A CSV asked to read to the end has no target short of it: it ends when
// every box has.
export const UNTIL_END = Object.freeze({});

const isLimitCall = ({ name }) => name === "limit";

const isLimitStage = (stage) =>
  stage.type === "object" && stage.entries.some(({ key }) => key === "$limit");

const stagesOf = (call) => {
  const [pipeline] = call.args;

  return call.name === "aggregate" && pipeline?.type === "array"
    ? pipeline.items
    : [];
};

// Whether the query's text sets its own limit: `.limit(n)` or `$limit`.
export const isLimitTyped = (tree) =>
  tree.calls.some(
    (call) => isLimitCall(call) || stagesOf(call).some(isLimitStage),
  );

const exportedOf = ({ query, typed, target }) =>
  typed && target === null ? query.limit : MAX_LIMIT;

const askedOf = (asking) =>
  asking.body.csv
    ? exportedOf(asking)
    : (asking.body.limit ?? asking.query.limit);

// The rows an answer reads (`limit`) and, read in one go rather than in
// windows, shows (`shows`). A CSV reads up to 5,000 rows, but no more than a
// limit the query typed shows: windows past that are cut to what was shown.
// Otherwise it is the LIMIT GPA sends, or the query's. Never more cells than
// the checker allows: a limit is cut to fit.
export const limitOf = (asking) => {
  const { body, query, typed } = asking;
  const asked = askedOf(asking);
  const fits = Math.floor(MAX_CELLS / query.columns.length);
  const limit = Math.min(asked, fits);
  const capsShown = Boolean(body.csv && typed);

  return {
    limit,
    shows: capsShown ? Math.min(limit, query.limit) : limit,
  };
};

export const asQueryPositions = (positions) =>
  positions &&
  Object.fromEntries(
    Object.entries(positions).map(([id, at]) => [id, at && encodeCursor(at)]),
  );

const isPast = (position, target, box) =>
  position === null ||
  (target !== null &&
    compareKeys({ ...position, box }, { ...target, box }) >= 0);

const hasReached = (positions, target) =>
  target !== UNTIL_END &&
  Object.entries(target).every(([box, at]) =>
    isPast(positions[box] ?? null, at, box),
  );

// A window that ran out of work ended early: there is no more to read in
// this request. One that only skipped a record too large to search goes on.
const ranOutOfWork = (parts) =>
  parts.some(({ boxes }) =>
    boxes.some(({ partial, skipped = 0 }) => partial === true && !skipped),
  );

// Whether a CSV window reaches what it was asked to read.
const isComplete = ({ shown, merged, target }) =>
  merged.end ||
  shown.length < merged.rows.length ||
  hasReached(merged.positions, target);

const stateOf = ({ parts, shown, merged, rows, target, cap }) => {
  if (isComplete({ shown, merged, target })) {
    return "done";
  }

  return rows.length >= cap || ranOutOfWork(parts) ? "short" : "more";
};

// A CSV that stops short of where it was asked to read, for any reason, is
// partial: it says where it got to and how to go on from there.
const csvAnswer = ({ parts, rows, merged, skipped }, short) => ({
  parts,
  partial: short,
  merged: {
    rows,
    window: {
      to: merged.to,
      end: merged.end,
      positions: short ? encodePositions(merged.positions) : null,
      skipped,
    },
  },
});

// A CSV reads from the top down to where the shown windows ended, at most
// the rows its LIMIT says.
const readCsvWindow = async ({ query, run, target, rows, positions }) => {
  const limit = query.limit - rows.length;
  const parts = await partsOf(
    {
      ...query,
      limit,
      positions: asQueryPositions(positions),
      ...(positions && { window: true }),
    },
    run,
  );

  if (parts[0].read !== "windowed") {
    return { parts, state: "exact" };
  }

  const boxes = parts.flatMap((part) => part.boxes);
  const merged = mergeWindowed(boxes, { limit });
  const shown = merged.rows.filter(shownBy(target));

  rows.push(...shown);

  return {
    parts,
    merged,
    skipped: windowEnding(boxes, merged.cut).skipped,
    state: stateOf({ parts, shown, merged, rows, target, cap: query.limit }),
  };
};

// A later window that runs out of time, or finds Caseworking full, ends the
// CSV at its last whole window, keeping its rows, and stops what is still
// reading; the first such window is refused, as any read.
const STOPS_A_CSV = ["TOO_SLOW", "FULL", "BUSY"];

const keepsCsvRows = (error) => STOPS_A_CSV.includes(refusalOf(error));

// The answer once a window is the last, or null to read another.
const csvEnd = (window, withRows) => {
  if (window.state === "exact") {
    return { parts: window.parts };
  }

  if (window.state === "done") {
    return csvAnswer(withRows(), false);
  }

  return window.state === "short" ? csvAnswer(withRows(), true) : null;
};

// A CSV's windows, from the top down to `target`: an exact read answers its
// parts as they are.
export const readCsvWindows = async (query, run, target) => {
  const rows = [];
  const withRows = (read) => ({
    ...read.at(-1),
    rows,
    skipped: skippedIn(read.map(({ skipped }) => skipped)),
  });

  const { windows, ended, failed } = await readInTurn({
    meter: run.meter,
    readWindow: (read) =>
      readCsvWindow({
        query,
        run,
        target,
        rows,
        positions: read.at(-1)?.merged.positions ?? null,
      }),
    endOf: (read) => csvEnd(read.at(-1), () => withRows(read)),
    keepsRowsOn: keepsCsvRows,
  });

  if (ended) {
    return ended;
  }

  if (failed) {
    run.stop.abort();
  }

  return csvAnswer(withRows(windows), true);
};
