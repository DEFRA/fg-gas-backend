import { encodeCursor } from "../../common/buckets/cursor.js";
import {
  cellsAllowanceOf,
  costOfAll,
  fittingCount,
  less,
  rowCostOf,
} from "../../common/explore/cells-allowance.js";
import {
  compareKeys,
  encodePositions,
  mergeWindowed,
  windowEnding,
} from "../../common/explore/merge.js";
import {
  DOWNLOAD_BYTES,
  MAX_LIMIT,
  rowCapOf,
} from "../../common/explore/query-schema.js";
import { refusalOf } from "../../common/explore/refusal.js";
import { shownBy } from "./answer.js";
import { partsOf } from "./federate.js";
import { CAPPED, readInTurn, skippedIn } from "./windows.js";

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

// How a person raises the rows a query reads: `.limit(n)` after a find, a
// `$limit` stage in an aggregate; a distinct or a count can't be raised.
const RAISES = { find: "limit", aggregate: "stage" };

export const raiseOf = (tree) => RAISES[tree.calls[0]?.name] ?? null;

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
  const limit = Math.min(asked, rowCapOf(query.columns));
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

const skippedCount = (skipped) => skipped?.length ?? 0;

// A window that ran out of work ended early: there is no more to read in
// this request. One that only skipped a record too large to search goes on,
// and one its cells allowance ended (`cut`) stopped at its bytes.
const hasRunOut = ({ partial, cut, skipped }) =>
  partial === true && !cut && skippedCount(skipped) === 0;

const boxesOfParts = (parts) => parts.flatMap(({ boxes }) => boxes);

const ranOutOfWork = (parts) => boxesOfParts(parts).some(hasRunOut);

const isCutAtBytes = (parts, cut) =>
  cut || boxesOfParts(parts).some((box) => box.cut === true);

// Whether a CSV window reaches what it was asked to read.
const isComplete = ({ shown, merged, target }) =>
  merged.end ||
  shown.length < merged.rows.length ||
  hasReached(merged.positions, target);

// Why a CSV stops short, as the download says it: its rows, its time (or
// work), its windows, its bytes, or a later window that failed.
export const STOPPED = {
  rows: "rows",
  time: "time",
  windows: "windows",
  bytes: "bytes",
  error: "error",
};

const shortOf = ({ parts, rows, cap, cut }) => {
  if (isCutAtBytes(parts, cut)) {
    return STOPPED.bytes;
  }

  if (rows.length >= cap) {
    return STOPPED.rows;
  }

  return ranOutOfWork(parts) ? STOPPED.time : null;
};

const stateOf = (window) => {
  if (!window.cut && isComplete(window)) {
    return { state: "done", stopped: null };
  }

  const stopped = shortOf(window);

  return { state: stopped ? "short" : "more", stopped };
};

// A CSV that stops short of where it was asked to read, for any reason, is
// partial: it says where it got to and how to go on from there.
const csvAnswer = ({ parts, rows, merged, skipped, stopped }, short) => ({
  parts,
  partial: short,
  stopped: short ? stopped : null,
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

// A window's merged rows, cut where the download's cells allowance runs
// out, as a limit would cut them.
const fittedWindow = (boxes, limit, left) => {
  const merged = mergeWindowed(boxes, { limit });
  const fit = fittingCount(merged.rows, left);

  return fit < merged.rows.length
    ? { merged: mergeWindowed(boxes, { limit: fit }), cut: true }
    : { merged, cut: false };
};

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
  const { merged, cut } = fittedWindow(
    boxes,
    limit,
    less(cellsAllowanceOf(DOWNLOAD_BYTES), costOfAll(rows, rowCostOf)),
  );
  const shown = merged.rows.filter(shownBy(target));

  rows.push(...shown);

  return {
    parts,
    merged,
    skipped: windowEnding(boxes, merged.cut).skipped,
    ...stateOf({ parts, shown, merged, rows, target, cap: query.limit, cut }),
  };
};

// A later window that runs out of time, or finds Caseworking full, ends the
// CSV at its last whole window, keeping its rows, and stops what is still
// reading; the first such window is refused, as any read.
const STOPS_A_CSV = ["TOO_SLOW", "FULL", "BUSY"];

const keepsCsvRows = (error) => STOPS_A_CSV.includes(refusalOf(error));

const stoppedOf = (failed, short) => {
  if (failed) {
    return refusalOf(failed) === "TOO_SLOW" ? STOPPED.time : STOPPED.error;
  }

  return short === CAPPED ? STOPPED.windows : STOPPED.time;
};

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
  const withRows = (read, stopped) => ({
    ...read.at(-1),
    rows,
    skipped: skippedIn(read.map(({ skipped }) => skipped)),
    ...(stopped && { stopped }),
  });

  const { windows, ended, failed, short } = await readInTurn({
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

  return csvAnswer(withRows(windows, stoppedOf(failed, short)), true);
};

// ── What a download says of itself ──

// What a complete exact answer holds: its groups for a grouped or distinct
// one, else its records. A count is one row, always whole.
const foundOf = ({ count }) => count.groups ?? count.n;

// Why a download holds fewer rows than were found, if it does: a typed
// limit is what was asked, so no stop.
const isWhole = (answer, typed) =>
  typed || !answer.count || answer.mode === "count";

const exactStop = (answer, { typed }) =>
  !isWhole(answer, typed) && foundOf(answer) > answer.rows.length
    ? STOPPED.rows
    : null;

const windowStop = (answer, { shows }) => {
  if (!answer.window || answer.window.end) {
    return null;
  }

  return answer.rows.length >= shows ? STOPPED.rows : STOPPED.time;
};

const stopOf = (answered, answer, limits) => {
  if (answered.stopped !== undefined) {
    return answered.stopped;
  }

  if (answer.cutAtBytes) {
    return STOPPED.bytes;
  }

  return windowStop(answer, limits) ?? exactStop(answer, limits);
};

// A download's row limit, why it stopped short, if it did, and how far back
// it searched. `answered` is what readCsvWindows gave, `answer` what
// answerFrom made of it, `limits` the typed limit and the rows it shows.
export const downloadOf = (answered, answer, limits) => ({
  rows: limits.shows,
  stopped: stopOf(answered, answer, limits),
  searchedTo: answer.window?.to ?? answer.oldest ?? null,
});

// An answer without what only its download is worked out from.
const DOWNLOAD_FACTS = new Set(["cutAtBytes", "oldest"]);

export const withoutDownloadFacts = (answer) =>
  Object.fromEntries(
    Object.entries(answer).filter(([key]) => !DOWNLOAD_FACTS.has(key)),
  );
