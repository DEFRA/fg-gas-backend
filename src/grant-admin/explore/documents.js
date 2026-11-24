import { valuesOf } from "../../common/explore/bson-bytes.js";
import { startOf } from "../../common/explore/document-start.js";
import { sentBytes } from "../../common/explore/large-answers.js";
import {
  boxesOf,
  fetchDocuments,
  fetchPart,
} from "../../common/explore/document-fetch.js";
import {
  DOCUMENTS_MODE,
  MAX_DOCUMENT_BYTES,
  MAX_LIMIT,
  ONE_DOCUMENT_ALLOWANCE,
  STARTS,
} from "../../common/explore/query-schema.js";
import { refusalOf, refuseQuery } from "../../common/explore/refusal.js";

// Documents are fetched in a second phase, for the rows an answer shows
// only: after the parts are merged and cut, from GAS's own boxes directly
// and from Caseworking's in one `documents` call a round, in the rows'
// order. A page sends each record's start; Show it its one document, up
// to the one-document allowance; a download every one.

// A record's stored size, by which whole documents are planned: one not
// known could be the largest.
export const storedSizeOf = (row) => row.fetch.size ?? MAX_DOCUMENT_BYTES;

const fits = (left, cost) =>
  cost.bytes <= left.bytes && cost.values <= left.values;

const docBytesOf = (doc) => Buffer.byteLength(doc, "base64");

// A document's start, cut from its bytes as a fetched record's is.
const startOfDoc = (doc) => {
  const start = startOf(Buffer.from(doc, "base64"));

  return { ...start, doc: start.doc.toString("base64") };
};

// Where an event was read: what a context says beside the records joined
// in it.
const ADDED = new Set(["service", "box"]);

const joinedOf = (context) =>
  Object.entries(context ?? {})
    .filter(([name, value]) => !ADDED.has(name) && typeof value === "string")
    .map(([, value]) => value);

const withoutJoined = (context) => {
  const added = Object.entries(context ?? {}).filter(([name]) =>
    ADDED.has(name),
  );

  return added.length ? Object.fromEntries(added) : null;
};

// What a fetched row costs: its document and every record joined beside
// it, in bytes and in the values they print.
export const costOf = (entry) => ({
  bytes: sentBytes([entry]),
  values: [entry.doc, ...joinedOf(entry.context)].reduce(
    (sum, text) => sum + valuesOf(Buffer.from(text, "base64")),
    0,
  ),
});

// ── Fetching in the rows' order ──

export const keyOf = ({ box, id, at }) => `${box}\n${id}\n${at.join(",")}`;

const ownBoxesOf = (run) =>
  new Map((run.own ? boxesOf(run.own) : []).map((box) => [box.id, box]));

const askedOf = (row) => ({
  box: row.fetch.box,
  id: row.fetch.id,
  at: row.fetch.at,
});

// A starts fetch holds every row it reads: it is sent no bytes to hold.
const fetchedShapeOf = (documents, bytes) =>
  documents.mode === STARTS ? documents : { ...documents, bytes };

const cwDocuments = (query, rows, run, bytes) =>
  run.cwPart(
    {
      ...query,
      mode: DOCUMENTS_MODE,
      groupBy: null,
      orderBy: null,
      positions: null,
      limit: rows.length,
      documents: fetchedShapeOf(query.documents, bytes),
      rows,
    },
    run,
  );

// What ends a starts fetch early, as its answer says it.
const ENDED = { TOO_SLOW: "time", TOO_COSTLY: "work" };

// Caseworking refusing a starts fetch out of time or work has answered
// none of its rows.
const endedEarly = (error) => {
  if (!Object.hasOwn(ENDED, refusalOf(error))) {
    throw error;
  }

  return { documents: [], ended: ENDED[refusalOf(error)] };
};

const startsFrom = (own, run) => (query, rows, bytes) =>
  own
    ? fetchPart(run.own, { ...query, rows }, run.meter)
    : cwDocuments(query, rows, run, bytes).catch(endedEarly);

const fetchFrom = (own, run) => async (query, rows, bytes) =>
  own
    ? {
        documents: await fetchDocuments(run.own, query, {
          rows,
          meter: run.meter,
          bytes,
        }),
      }
    : cwDocuments(query, rows, run, bytes);

const NOTHING = Promise.resolve({ documents: [] });

// One round's rows, each service's fetched at once, every entry by its
// row's key, and what ended each service's starts early: each service
// holds at most `bytes`, and the first it was asked for.
const fetchRound = async (query, rows, { run, bytes }) => {
  const own = ownBoxesOf(run);
  const asked = rows.map(askedOf);
  const ownAsked = asked.filter(({ box }) => own.has(box));
  const cwAsked = asked.filter(({ box }) => !own.has(box));
  const from = query.documents.mode === STARTS ? startsFrom : fetchFrom;
  const [ownPart, cwPart] = await Promise.all(
    [
      [ownAsked, true],
      [cwAsked, false],
    ].map(([part, isOwn]) =>
      part.length ? from(isOwn, run)(query, part, bytes) : NOTHING,
    ),
  );

  return {
    found: new Map(
      [...ownPart.documents, ...cwPart.documents].map((entry) => [
        keyOf(entry),
        entry,
      ]),
    ),
    ended: { own: ownPart.ended, cw: cwPart.ended },
  };
};

const entryOf = (found, row) => {
  const entry = found.get(keyOf(askedOf(row)));

  if (!entry) {
    throw new Error("Explore documents fetch left out a row");
  }

  return entry;
};

// Each row with what the fetch says of it, in the rows' order, a round at
// a time: `next(rows, from, last)` names a round's rows, told how the last
// round went ({ asked, settled, unread }), `bytes()` what each service may hold of
// them. A row a round couldn't hold (unread) starts the next, so each round
// settles one row at least.
export const fetchedInOrder = async function* (rows, ctx) {
  let from = 0;
  let last = null;

  while (from < rows.length) {
    const round = ctx.next(rows, from, last);
    const { found } = await fetchRound(ctx.query, round, {
      run: ctx.run,
      bytes: Math.max(1, ctx.bytes()),
    });

    last = { asked: round.length, settled: 0, unread: false };

    for (const row of round) {
      const entry = entryOf(found, row);

      if (entry.unread) {
        last.unread = true;
        break;
      }

      yield { row, entry };
      from += 1;
      last.settled += 1;
    }
  }
};

// The next rows whose records' stored sizes fit in `bytes`, at least one.
export const storedWithin = (bytes) => (rows, from) => {
  let left = bytes;
  let to = from;

  while (to < rows.length && (to === from || storedSizeOf(rows[to]) <= left)) {
    left -= storedSizeOf(rows[to]);
    to += 1;
  }

  return rows.slice(from, to);
};

// Rows asked for in a round of a projection, whose sizes aren't known
// until fetched: 50 first, twice as many after a round that held every row
// asked, twice as many as it settled (50 at least) after one that didn't.
// What a round holds is bounded by the fetch, whatever it asks for.
const FIRST_ROUND = 50;

const roundAfter = (last) => {
  if (last === null) {
    return FIRST_ROUND;
  }

  const grown = last.unread ? last.settled * 2 : last.asked * 2;

  return Math.min(MAX_LIMIT, Math.max(FIRST_ROUND, grown));
};

export const inRounds = (rows, from, last) =>
  rows.slice(from, from + roundAfter(last));

// ── A page ──

// A row as an answer shows it: its document, or the note that says why
// not, and the context its document is shown beside; joined records only
// beside a document.
const isSent = (docNote) => !docNote || docNote.changed === true;

const shown = (row, entry, docNote) => {
  const { fetch, ...rest } = row;
  const sent = isSent(docNote);

  return {
    ...rest,
    id: fetch.id,
    at: fetch.at,
    doc: sent ? entry.doc : null,
    context: sent ? (entry.context ?? null) : withoutJoined(entry.context),
    docNote,
  };
};

// Where an event was read, for a row never fetched: its service and box,
// as GAS declares its own boxes and Caseworking's box ids name its.
const boxContextOf = (run, box) => {
  if (!run.own?.added) {
    return null;
  }

  const declared = ownBoxesOf(run).get(box);

  if (declared) {
    return { service: declared.service, box: declared.box };
  }

  const [service, name] = box.split(".");

  return { service: service.toUpperCase(), box: name };
};

const NOTES = [
  ["gone", () => ({ gone: true })],
  ["tooLarge", () => ({ tooLarge: true })],
  ["changed", () => ({ changed: true })],
];

export const noteOf = (entry) => {
  const [, note] = NOTES.find(([name]) => entry[name] === true) ?? [];

  return note ? note() : null;
};

const isFetchedRow = (row) => Object.hasOwn(row, "fetch");

const workedOutBytes = (rows) =>
  rows
    .filter((row) => !isFetchedRow(row) && row.doc)
    .reduce((sum, { doc }) => sum + docBytesOf(doc), 0);

// ── Show it ──

// Show it's one row with its document, printed up to the one-document
// allowance: past it, the note says the document's bytes and values. Its
// start goes with it either way, for its line.
const settledAlone = (row, entry) => {
  if (!entry.doc) {
    return {
      row: { ...shown(row, entry, noteOf(entry)), start: null },
      sent: 0,
    };
  }

  const cost = costOf(entry);
  const start = startOfDoc(entry.doc);
  const sent = docBytesOf(start.doc);

  return fits(ONE_DOCUMENT_ALLOWANCE, cost)
    ? {
        row: { ...shown(row, entry, noteOf(entry)), start },
        sent: cost.bytes + sent,
      }
    : {
        row: {
          ...shown(row, entry, {
            later: docBytesOf(entry.doc),
            values: cost.values,
          }),
          start,
        },
        sent,
      };
};

export const withShownDocument = async (answer, { query, run }) => {
  const done = new Map();
  let sent = workedOutBytes(answer.rows);

  for await (const { row, entry } of fetchedInOrder(
    answer.rows.filter(isFetchedRow),
    {
      query,
      run,
      next: (all, from) => all.slice(from),
      bytes: () => ONE_DOCUMENT_ALLOWANCE.bytes,
    },
  )) {
    const settled = settledAlone(row, entry);

    done.set(row, settled.row);
    sent += settled.sent;
  }

  return {
    ...answer,
    rows: answer.rows.map((row) => done.get(row) ?? row),
    documents: { whole: query.documents.whole, bytes: sent },
  };
};

// ── A page's starts ──

const startRowOf = (run, row, entry) => {
  const { fetch, ...rest } = row;

  return {
    ...rest,
    id: fetch.id,
    at: fetch.at,
    start: entry.start ?? null,
    printed: entry.printed ?? null,
    context: boxContextOf(run, fetch.box),
    docNote: noteOf(entry),
  };
};

// A group's, a value's or a count's row with the start of its worked-out
// document, as a record's row has its record's.
const workedOutRowOf = (row) =>
  row.doc ? { ...row, start: startOfDoc(row.doc) } : row;

const startBytesOf = (rows) =>
  rows
    .filter(({ start }) => start)
    .reduce((sum, { start }) => sum + docBytesOf(start.doc), 0);

// A page that ends before its first row is refused as a read out of time
// or work would be, by the service that didn't read it; one that can't be
// continued (an exact or full read) is refused the same way.
const REFUSED = { time: "TOO_SLOW", work: "TOO_COSTLY" };

const refusedAt = (row, run, ended) => {
  const own = ownBoxesOf(run).has(row.fetch.box);
  const refusal = refuseQuery(REFUSED[own ? ended.own : ended.cw]);

  return own ? refusal : Object.assign(refusal, { service: "CW" });
};

const checkContinued = (answer, listed, read, { run, ended }) => {
  if (read === 0 || answer.read !== "windowed") {
    throw refusedAt(listed[read], run, ended);
  }
};

// Each record row of a page with its start, fetched in the rows' order from
// GAS's boxes and Caseworking's at once. Each service reads its rows in
// order up to its deadline, so the page ends at the first row not read:
// `shorter(n)` is the answer for its first n rows, which ends its window
// there, `partial`, Keep looking going on from that row. Groups, values and
// a count carry their worked-out documents already, and their starts.
export const withStarts = async (answer, { query, run, shorter }) => {
  const listed = answer.rows.filter(isFetchedRow);
  const { found, ended } = listed.length
    ? await fetchRound(query, listed, { run, bytes: 1 })
    : { found: new Map() };
  const unread = listed.findIndex((row) => !found.has(keyOf(askedOf(row))));

  if (unread !== -1) {
    checkContinued(answer, listed, unread, { run, ended });
  }

  const page = unread === -1 ? answer : { ...shorter(unread), partial: true };
  const rows = page.rows.map((row) =>
    isFetchedRow(row)
      ? startRowOf(run, row, found.get(keyOf(askedOf(row))))
      : workedOutRowOf(row),
  );

  return {
    ...page,
    rows,
    documents: {
      whole: query.documents.whole,
      bytes: startBytesOf(rows) + workedOutBytes(rows),
    },
  };
};

const withoutFetch = (row) =>
  Object.fromEntries(Object.entries(row).filter(([key]) => key !== "fetch"));

// Without documents, a row is what it shows.
export const withoutDocuments = (answer) => ({
  ...answer,
  rows: answer.rows.map(withoutFetch),
  documents: null,
});

// A row of a download, as its line carries it: never past an allowance.
export const downloadRowOf = (row, entry) => shown(row, entry, noteOf(entry));
