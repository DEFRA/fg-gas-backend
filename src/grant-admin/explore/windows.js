import { timeLeftOf } from "../../common/explore/meter.js";
import { MAX_CELLS } from "../../common/explore/query-schema.js";
import { columnsOf } from "./answer.js";

// As many windows in one request as a list's pages.
export const MAX_WINDOWS = 50;

// Another window is read only with this many times the last one's time left
// before the deadline.
const WINDOW_MARGIN = 1.5;

// Why windows stopped short of their own end: the cap, or too little time
// for one more.
export const CAPPED = "CAPPED";
export const OUT_OF_TIME = "OUT_OF_TIME";

const hasTimeFor = (meter, tookMs) =>
  timeLeftOf(meter) > tookMs * WINDOW_MARGIN;

const nextOf = async ({ readWindow, keepsRowsOn }, windows) => {
  try {
    return { window: await readWindow(windows) };
  } catch (error) {
    if (windows.length && keepsRowsOn(error)) {
      return { failed: error };
    }

    throw error;
  }
};

const shortOf = (windows, meter, tookMs) => {
  if (windows.length >= MAX_WINDOWS) {
    return CAPPED;
  }

  return hasTimeFor(meter, tookMs) ? null : OUT_OF_TIME;
};

const settledAfter = (turn, windows, tookMs) => {
  const ended = turn.endOf(windows);

  if (ended) {
    return { windows, ended };
  }

  const short = shortOf(windows, turn.meter, tookMs);

  return short ? { windows, short } : null;
};

// Windows read in turn, each from where the last ended, under one meter.
// `readWindow(windows)` reads the next after those read; `endOf(windows)` is
// why they end there, or null to read on. They also end with a later window
// that failed in a way `keepsRowsOn` allows (`failed`, the rows before it
// standing), at the cap, or before a window there is no time for (`short`).
// A first window that fails is refused, as any read.
export const readInTurn = async (turn) => {
  const windows = [];

  for (;;) {
    const started = Date.now();
    const { window, failed } = await nextOf(turn, windows);

    if (failed) {
      return { windows, failed };
    }

    windows.push(window);

    const settled = settledAfter(turn, windows, Date.now() - started);

    if (settled) {
      return settled;
    }
  }
};

// Every window's skipped records, in order.
export const skippedIn = (lists) => lists.flatMap((skipped) => skipped ?? []);

// ── `windows: N`, each window one answer ──

const TOO_MANY_CELLS = { statusCode: 413, code: "TOO_MANY_CELLS" };
const TOO_LATE = { statusCode: 408, code: "QUERY_TOO_SLOW" };

const nextStart = ({ window }) =>
  window && !window.end ? window.positions : null;

const bodyAfter = (body, answers) =>
  answers.length ? { ...body, positions: nextStart(answers.at(-1)) } : body;

const rowsIn = (answers) =>
  answers.reduce((sum, { rows }) => sum + rows.length, 0);

// Whether one more window's rows fit: in the cells one answer holds, and
// within the cells allowance still left.
const hasRoomFor = (answers, { query, limit, hasCellsLeft }) =>
  (rowsIn(answers) + limit) * query.columns.length <= MAX_CELLS &&
  hasCellsLeft();

// Why the answers end after these, or null to read on: every window asked is
// read, or the next could pass the cells one answer holds, so isn't read.
const answersEnd = ({ body, query, limit, hasCellsLeft }, answers) => {
  if (answers.length === body.windows || nextStart(answers.at(-1)) === null) {
    return { stopped: null };
  }

  return hasRoomFor(answers, { query, limit, hasCellsLeft })
    ? null
    : { stopped: TOO_MANY_CELLS };
};

const stoppedOf = ({ ended, failed }, stoppedBy) => {
  if (ended) {
    return ended.stopped;
  }

  return failed ? stoppedBy(failed) : TOO_LATE;
};

const documentsOf = (answers) => {
  const { documents } = answers.at(-1);

  return (
    documents && {
      ...documents,
      bytes: answers.reduce(
        (sum, answered) => sum + answered.documents.bytes,
        0,
      ),
    }
  );
};

// Every row read, its columns' kinds as all the windows say, the records
// every window skipped, the last window's way on, and why they stopped.
const joined = (query, answers, stopped) => {
  const last = answers.at(-1);
  const rows = answers.flatMap((answered) => answered.rows);

  return {
    ...last,
    columns: columnsOf(query, rows),
    rows,
    documents: documentsOf(answers),
    window: last.window && {
      ...last.window,
      skipped: skippedIn(answers.map(({ window }) => window?.skipped)),
    },
    windowRows: answers.map((answered) => answered.rows.length),
    stopped,
  };
};

// Windows 1 to N, the first from `body.positions` or the top, each read by
// `readAnswer(body)` as one query, at most `limit` rows. A later window that
// fails keeps the rows before it, `stoppedBy(error)` saying why. No window is
// read once `hasCellsLeft()` says the cells allowance is spent.
export const readAnswerWindows = async ({
  body,
  query,
  limit,
  meter,
  readAnswer,
  stoppedBy,
  hasCellsLeft = () => true,
}) => {
  const read = await readInTurn({
    meter,
    readWindow: (answers) => readAnswer(bodyAfter(body, answers)),
    endOf: (answers) =>
      answersEnd({ body, query, limit, hasCellsLeft }, answers),
    keepsRowsOn: () => true,
  });

  return joined(query, read.windows, stoppedOf(read, stoppedBy));
};
