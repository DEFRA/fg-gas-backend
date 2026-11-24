import {
  DOWNLOAD_BYTES,
  MAX_DOCUMENT_BYTES,
} from "../../common/explore/query-schema.js";
import { sentBytes } from "../../common/explore/large-answers.js";
import { refusalOf } from "../../common/explore/refusal.js";
import { STOPPED } from "./csv.js";
import {
  downloadRowOf,
  fetchedInOrder,
  inRounds,
  storedWithin,
} from "./documents.js";

// Download JSON, as the values of its NDJSON lines: a header (the answer's
// summary), one a row (its typed `_id`, context and document, fetched a
// round at a time), and an end (why it stopped, if it did, how far it
// searched, and what it skipped). Every row's document is sent, none past
// an allowance; GAS holds one round's at a time.

// What one round holds, whole documents planned by their stored sizes.
const ROUND_BYTES = MAX_DOCUMENT_BYTES;

// Show it's header says whether the record is gone once its one row is
// fetched: no row read, or its document gone when fetched.
const firstEntryOf = (first) => (first?.value ? first.value.entry : null);

const goneOf = (answer, first) =>
  answer.documents.gone || firstEntryOf(first)?.gone === true;

const shownOf = (answer, first) =>
  answer.documents?.gone === undefined ? {} : { gone: goneOf(answer, first) };

const headerOf = (answer, query, first) => ({
  header: {
    source: answer.source,
    mode: answer.mode,
    read: answer.read,
    columns: answer.columns,
    count: answer.count,
    groups: answer.groups,
    unwound: answer.unwound,
    unseen: answer.unseen,
    partial: answer.partial,
    limits: answer.limits,
    documents: { whole: query.documents.whole, ...shownOf(answer, first) },
    download: { rows: answer.download.rows },
  },
});

const rowLineOf = ({ open, id, at, doc, context, docNote }) => ({
  row: { open, id, at, doc, context, docNote },
});

const skippedOf = (answer) => (answer.window ? answer.window.skipped : []);

const endOf = (answer, stopped) => ({
  end: {
    stopped,
    searchedTo: answer.download.searchedTo,
    skipped: skippedOf(answer),
  },
});

const isFetchedRow = (row) => Object.hasOwn(row, "fetch");

// A fetch that ran out of time ends the download at its last whole row;
// any other failure ends it too, as an error.
const stoppedBy = (error) =>
  ["TOO_SLOW", "TOO_COSTLY"].includes(refusalOf(error))
    ? STOPPED.time
    : STOPPED.error;

// A caller that went away stops the download at its next row.
const isGone = (run) => Boolean(run.gone?.aborted);

const isPastBytes = (ending, bytes) =>
  ending.sent > 0 && ending.bytes + bytes > DOWNLOAD_BYTES;

// Groups, values and a count are worked out, their documents with them.
const workedOut = async function* (rows) {
  for (const row of rows) {
    yield { row, entry: null };
  }
};

const entriesOf = (answer, { query, run }) => {
  const rows = answer.rows.filter(isFetchedRow);

  return rows.length
    ? fetchedInOrder(rows, {
        query,
        run,
        next: query.documents.whole ? storedWithin(ROUND_BYTES) : inRounds,
        bytes: () => ROUND_BYTES,
      })
    : workedOut(answer.rows);
};

const sentOf = ({ row, entry }) => {
  if (!entry) {
    return { line: row, bytes: sentBytes([row]) };
  }

  return { line: downloadRowOf(row, entry), bytes: sentBytes([entry]) };
};

// Each row's line in turn, within the download's bytes; why they stopped,
// if they did before the answer's own end.
const rowLines = async function* (answer, how, entries) {
  const { ending } = how;

  for await (const fetched of entries) {
    const { line, bytes } = sentOf(fetched);

    if (isPastBytes(ending, bytes)) {
      return STOPPED.bytes;
    }

    yield rowLineOf(line);
    ending.sent += 1;
    ending.bytes += bytes;

    if (isGone(how.run)) {
      return STOPPED.error;
    }
  }

  return answer.download.stopped;
};

const stoppedRows = async function* (answer, how, entries) {
  try {
    return yield* rowLines(answer, how, entries);
  } catch (error) {
    const stopped = stoppedBy(error);

    how.ending.error = stopped === STOPPED.error ? error : null;

    return stopped;
  }
};

// The first entry taken before the header, for Show it, or what failed.
const pulled = async (entries) => {
  try {
    return await entries.next();
  } catch (error) {
    return { error };
  }
};

// The entries again, the one taken first before them.
const NOTHING_TAKEN = { done: true };

const takenFirst = (taken) => {
  const first = taken ?? NOTHING_TAKEN;

  if (first.error) {
    throw first.error;
  }

  return first.done ? [] : [first.value];
};

const resumed = async function* (first, entries) {
  yield* takenFirst(first);
  yield* { [Symbol.asyncIterator]: () => entries };
};

// The download's lines; `ending` says, as they go, how many rows were sent
// and how it ended: `stopped`, and the `error` that ended it, if one did. A
// failure after the header still ends with an end line, `stopped: "error"`.
// Show it's header waits for its one row's fetch, so it says whether the
// record is gone.
export const downloadLines = async function* (answer, { query, run, ending }) {
  const how = { query, run, ending };
  const entries = entriesOf(answer, how)[Symbol.asyncIterator]();
  const first =
    answer.documents?.gone === undefined ? null : await pulled(entries);

  yield headerOf(answer, query, first);

  ending.stopped = yield* stoppedRows(answer, how, resumed(first, entries));

  yield endOf(answer, ending.stopped);

  ending.done = true;
};

// How a download has gone so far: `done` once its end line is taken.
export const downloadEnding = () => ({
  sent: 0,
  bytes: 0,
  stopped: null,
  error: null,
  done: false,
});
