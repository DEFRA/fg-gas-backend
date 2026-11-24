import { BSON } from "mongodb";
import { elementsOf, isIdText, valueKeyOf, valuesOf } from "./bson-bytes.js";
import {
  fetchJoined,
  isOwnPath,
  joinedOf,
  joinedShapeOf,
  joinedTestsOf,
  joinsOf,
  localOf,
  testPathsOf,
  testProjectionOf,
  wantedOf,
} from "./document-joined.js";
import {
  CHUNK,
  START_RESERVE_MS,
  UNPARSED,
  chargedByKept,
  chargedByStored,
  checkReserve,
  fetchBox,
  fetchChunk,
  planOf,
  rowKeyOf,
} from "./document-read.js";
import { startOf } from "./document-start.js";
import { compileWhere } from "./evaluate.js";
import { readersFor } from "./fields.js";
import { freely, step } from "./meter.js";
import { MAX_DOCUMENT_BYTES, STARTS } from "./query-schema.js";
import { refusalOf, refuseQuery } from "./refusal.js";
import { chargeTo, costOf as testCostOf } from "./run-box.js";
import { fullBox } from "./run-full.js";

export { START_RESERVE_MS } from "./document-read.js";

// Documents are fetched for the rows an answer shows, after the merge: by
// `_id` from each box, in an aggregate Explore builds itself, read raw, so
// each document's bytes are mongod's own.

// A record's `_id`, sent as the BSON of { _id }: the value to read it by,
// and its bytes, by which a fetched record is matched to its row.
const invalidUnless = (holds) => {
  if (!holds) {
    throw refuseQuery("INVALID");
  }
};

export const idValueOf = (id) => {
  invalidUnless(isIdText(id, MAX_DOCUMENT_BYTES));

  const buf = Buffer.from(id, "base64");
  const [element] = elementsOf(buf);

  return {
    value: BSON.deserialize(buf, UNPARSED)._id,
    key: valueKeyOf(buf, element),
  };
};

// ── What one fetch holds ──

// At most `bytes` of documents and their joined records, each charged to
// its row. Past it the rows asked last are let go, unread, to be asked
// again; the first held is always kept, so a fetch holds `bytes` and one
// row's at most. A row asked after one let go is never held.
const holderOf = (bytes) => {
  const costs = new Map();
  let spent = 0;
  let firstLetGo = Infinity;

  const letGoLast = () => {
    const last = Math.max(...costs.keys());

    spent -= costs.get(last);
    costs.delete(last);
    firstLetGo = Math.min(firstLetGo, last);

    return last;
  };

  const isOver = () => spent > bytes && costs.size > 1;

  return {
    admits: (n) => n < firstLetGo,
    isUnread: (n) => n >= firstLetGo,
    // Charges row `n`, and says which rows that let go.
    charge: (n, cost) => {
      const letGo = [];

      costs.set(n, (costs.get(n) ?? 0) + cost);
      spent += cost;

      while (isOver()) {
        letGo.push(letGoLast());
      }

      return letGo;
    },
  };
};

// The documents fetched so far, by the row's place in the order asked.
const foundOf = (holder) => {
  const found = new Map();

  return {
    found,
    holder,
    take: (n, result) => {
      if (found.has(n) || !holder.admits(n)) {
        return;
      }

      found.set(n, { ...result, doc: Buffer.from(result.doc) });
      holder.charge(n, result.doc.length).forEach((gone) => found.delete(gone));
    },
  };
};

// ── The filter, again ──

const changedOf = (query, readers, box, meter) => {
  const holds = compileWhere(query.where, readers.readerOf, chargeTo(meter));

  return (test, attached) =>
    !holds(
      {
        ...test,
        ...Object.fromEntries(
          Object.entries(attached).map(([as, record]) => [
            as,
            record?.test ?? null,
          ]),
        ),
      },
      box,
    );
};

const base64Of = (buf) => buf.toString("base64");

// Where an event was read, and the records joined beside a row.
const contextOf = (source, box, joined) => {
  const added = source.added ? { service: box.service, box: box.box } : {};
  const context = { ...added, ...joined };

  return Object.keys(context).length ? context : null;
};

const contextFor = (source, box, attached) =>
  contextOf(
    source,
    box,
    Object.fromEntries(
      Object.entries(attached).map(([as, record]) => [
        as,
        record ? base64Of(record.doc) : null,
      ]),
    ),
  );

// What a fetch says of one row: its document, whether its record no longer
// passes the query's filter, and what it is shown beside; or that it is
// gone, too large for mongod to make, or unread (past what one fetch holds).
const noteOf = (n, result, ctx) => {
  if (ctx.holder.isUnread(n)) {
    return { unread: true };
  }

  if (!result) {
    return { gone: true };
  }

  return result.tooLarge ? { tooLarge: true } : null;
};

const answerOf = (n, ctx) => {
  const result = ctx.found.get(n);
  const box = ctx.boxes.get(ctx.rows[n].box);
  const note = noteOf(n, result, ctx);

  if (note) {
    return { ...note, context: contextOf(ctx.source, box, {}) };
  }

  const attached = joinedOf(ctx.joins, ctx.joined, result.test);

  return {
    doc: base64Of(result.doc),
    ...(ctx.changed.has(n) && { changed: true }),
    context: contextFor(ctx.source, box, attached),
  };
};

// The boxes a source reads: its one collection, or its buckets.
export const boxesOf = (source) =>
  source.size === "small" ? [fullBox(source)] : source.boxes;

const asRow = (asked, n) => {
  const { value, key } = idValueOf(asked.id);

  return { ...asked, n, id: value, idKey: key, key: rowKeyOf(key, asked.at) };
};

const fetchContextOf = (source, query, { rows, meter, bytes }) => {
  const readers = readersFor(source);
  const joins = joinsOf(source, query);
  const ownTests = testPathsOf(query, readers).filter(isOwnPath(joins));
  const { found, holder, take } = foundOf(holderOf(bytes));

  return {
    source,
    query,
    meter,
    readers,
    joins,
    found,
    holder,
    take,
    rows: rows.map(asRow),
    boxes: new Map(boxesOf(source).map((box) => [box.id, box])),
    testing: testProjectionOf([...ownTests, ...joins.flatMap(localOf)]),
    reserve: 0,
    charged: chargedByStored,
  };
};

const changesOf = (ctx) =>
  new Map(
    [...ctx.boxes.values()].map((box) => [
      box.id,
      changedOf(ctx.query, ctx.readers, box, ctx.meter),
    ]),
  );

const NOT_FREE = { reserve: 0, free: false };

const testOfRow = (ctx, n) => (ctx.query.where ? ctx.found.get(n)?.test : null);

const isChanged = async (row, ctx, changes, { reserve, free }) => {
  const test = testOfRow(ctx, row.n);

  if (!test) {
    return false;
  }

  checkReserve(ctx.meter, reserve);
  await step(ctx.meter, testCostOf(ctx.query.where), free);

  const changed = () =>
    changes.get(row.box)(test, joinedOf(ctx.joins, ctx.joined, test));

  return free ? freely(ctx.meter, changed) : changed();
};

// Each held row's record tested again, in the order asked, charged as a
// read's test is, `free` of the work budget in a starts fetch, and within
// the time left less `reserve`; `into` keeps the rows whose record no
// longer passes and how many rows were tested.
const recheck = async (rows, ctx, into, options) => {
  const changes = changesOf(ctx);

  for (const row of rows) {
    if (await isChanged(row, ctx, changes, options)) {
      into.changed.add(row.n);
    }

    into.tested += 1;
  }
};

const recheckedOf = () => ({ changed: new Set(), tested: 0 });

// The documents of the rows asked, [{ box, id, at }], in that order, each
// with what the fetch says of it (answerOf). It holds at most `bytes` of
// documents and joined records, and one row past them: the first asked.
// Each box of `source` is read once for its rows.
const checkBoxes = (ctx) => {
  if (ctx.rows.some((row) => !ctx.boxes.has(row.box))) {
    throw refuseQuery("INVALID");
  }
};

const fetchWhole = async (source, query, asked) => {
  const ctx = fetchContextOf(source, query, asked);

  checkBoxes(ctx);

  for (const id of new Set(ctx.rows.map((row) => row.box))) {
    await fetchBox(
      ctx.boxes.get(id),
      ctx.rows.filter((row) => row.box === id),
      ctx,
    );
  }

  const joined = [];

  for (const attach of ctx.joins) {
    joined.push(await fetchJoined(attach, ctx));
  }

  const rechecked = recheckedOf();

  await recheck(ctx.rows, { ...ctx, joined }, rechecked, NOT_FREE);

  const done = { ...ctx, joined, changed: rechecked.changed };

  return ctx.rows.map((row) => ({
    box: row.box,
    id: asked.rows[row.n].id,
    at: row.at,
    ...answerOf(row.n, done),
  }));
};

// ── Starts ──

// Every row asked is held: a start is small.
const EVERY_ROW = { admits: () => true, isUnread: () => false };

const keptOf = (result) =>
  result.tooLarge
    ? result
    : {
        start: startOf(result.doc),
        printed: { bytes: result.doc.length, values: valuesOf(result.doc) },
        test: result.test,
      };

// Each record's start, cut as it is read, and what it printed whole; the
// bytes kept, by which it is charged.
const startsFoundOf = () => {
  const found = new Map();
  const isNew = (n) => n !== undefined && !found.has(n);

  return {
    found,
    holder: EVERY_ROW,
    take: (n, result) => {
      if (!isNew(n)) {
        return 0;
      }

      const kept = keptOf(result);

      found.set(n, kept);

      return kept.start?.doc.length ?? 0;
    },
  };
};

// Rows are read in the order asked, 1 first, then twice as many a round up
// to CHUNK, so a fetch ended early has read a prefix of them.
const roundsOf = (rows) => {
  const rounds = [];

  let from = 0;
  let size = 1;

  while (from < rows.length) {
    rounds.push(rows.slice(from, from + size));
    from += size;
    size = Math.min(CHUNK, size * 2);
  }

  return rounds;
};

const byBox = (rows) => {
  const boxes = new Map();

  rows.forEach((row) =>
    boxes.set(row.box, [...(boxes.get(row.box) ?? []), row]),
  );

  return boxes;
};

// Each box's rows of a round, a row settled (found, or gone) once its box's
// read of them ends.
const fetchRound = async (rows, ctx) => {
  for (const [id, boxRows] of byBox(rows)) {
    await fetchChunk(planOf(ctx.boxes.get(id), ctx), boxRows, ctx);
    boxRows.forEach(({ n }) => ctx.settled.add(n));
  }
};

const isSettled = (ctx) => (row) =>
  ctx.settled.has(row.n) || ctx.found.has(row.n);

// What ends a starts fetch early, and what its answer says ended it: the
// deadline less its reserve or mongod's own time, or the work budget.
const ENDS = { TOO_SLOW: "time", TOO_COSTLY: "work" };

// Reads until done, or until one of ENDS ends it: which, if one did.
const endOf = async (read) => {
  try {
    await read();

    return null;
  } catch (error) {
    if (!Object.hasOwn(ENDS, refusalOf(error))) {
      throw error;
    }

    return ENDS[refusalOf(error)];
  }
};

// The rows read, in the order asked, up to the first that wasn't, and what
// ended the read early.
const readPrefix = async (ctx) => {
  let ended = null;

  for (const round of roundsOf(ctx.rows)) {
    ended = await endOf(() => fetchRound(round, ctx));

    if (ended) {
      break;
    }
  }

  const unread = ctx.rows.findIndex((row) => !isSettled(ctx)(row));

  return {
    read: unread === -1 ? ctx.rows : ctx.rows.slice(0, unread),
    ended,
  };
};

// The joined records' tests are read in the reserve's first half, the
// second kept to answer in.
const JOINED_RESERVE_MS = START_RESERVE_MS / 2;

// The filter is tested again until a quarter of the reserve is left, kept
// to answer in.
const ANSWER_RESERVE_MS = JOINED_RESERVE_MS / 2;

const foundIn = (rows, found) =>
  new Map(
    rows.filter(({ n }) => found.has(n)).map(({ n }) => [n, found.get(n)]),
  );

// What the filter tests in the records the read rows join, read in their
// order a round at a time, past the work budget and into the reserve; the
// rows, up to the first whose joined records weren't read, and what ended
// their read early.
const joinedTestsFor = async (read, ctx) => {
  const joined = ctx.joins.map(() => new Map());
  const reading = { ...ctx, reserve: JOINED_RESERVE_MS, free: true };
  const shapes = ctx.joins.map((attach) =>
    joinedShapeOf(attach, ctx.query, ctx.readers),
  );
  let tested = 0;

  if (!ctx.query.where || !ctx.joins.length) {
    return { joined, tested: read, ended: null };
  }

  const ended = await endOf(async () => {
    for (const round of roundsOf(read)) {
      const found = foundIn(round, ctx.found);

      for (const [n, attach] of ctx.joins.entries()) {
        const tests = await joinedTestsOf(
          attach,
          wantedOf(attach, found),
          shapes[n],
          reading,
        );

        tests.forEach((test, key) => joined[n].set(key, test));
      }

      tested += round.length;
    }
  });

  return { joined, tested: read.slice(0, tested), ended };
};

const startEntryOf = (n, ctx) => {
  const result = ctx.found.get(n);

  if (!result) {
    return { gone: true };
  }

  if (result.tooLarge) {
    return { tooLarge: true };
  }

  return {
    start: { ...result.start, doc: base64Of(result.start.doc) },
    printed: result.printed,
    ...(ctx.changed.has(n) && { changed: true }),
  };
};

// The starts of the rows asked, in that order, each cut from its record as
// it is read: as many as were read, with the records they join, before the
// deadline less its reserve, mongod's time or the work budget ran out, up
// to the first that wasn't, and then what ended them (`ended`); each with
// the bytes and values its document printed whole, and whether its record
// no longer passes the filter; or that it is gone or too large to make.
// A starts fetch's work is its own, charged by the bytes it keeps whatever
// the read before it spent, within the request's deadline.
const ownWorkOf = (meter) => ({
  get deadline() {
    return meter.deadline;
  },
  budget: meter.budget,
  spent: 0,
  sliceStart: Date.now(),
});

// What ended the answer early: the latest step that did.
const endedBy = (...ends) => ends.find(Boolean) ?? null;

const fetchStarts = async (source, query, asked) => {
  const ctx = {
    ...fetchContextOf(source, query, {
      ...asked,
      meter: ownWorkOf(asked.meter),
      bytes: 0,
    }),
    ...startsFoundOf(),
    settled: new Set(),
    reserve: START_RESERVE_MS,
    charged: chargedByKept,
  };

  checkBoxes(ctx);

  const { read, ended } = await readPrefix(ctx);

  for (const row of ctx.rows.slice(read.length)) {
    ctx.found.delete(row.n);
  }

  const { joined, tested, ...joins } = await joinedTestsFor(read, ctx);
  const rechecked = recheckedOf();
  const recheckEnded = await endOf(() =>
    recheck(tested, { ...ctx, joined }, rechecked, {
      reserve: ANSWER_RESERVE_MS,
      free: true,
    }),
  );
  const answered = tested.slice(0, rechecked.tested);
  const done = { ...ctx, joined, changed: rechecked.changed };
  const documents = answered.map((row) => ({
    box: row.box,
    id: asked.rows[row.n].id,
    at: row.at,
    ...startEntryOf(row.n, done),
  }));

  return answered.length < ctx.rows.length
    ? { documents, ended: endedBy(recheckEnded, joins.ended, ended) }
    : { documents };
};

// The documents of the rows asked, or in the `starts` mode their starts.
export const fetchDocuments = async (source, query, asked) =>
  query.documents.mode === STARTS
    ? (await fetchStarts(source, query, asked)).documents
    : fetchWhole(source, query, asked);

// A service's answer to a `documents` fetch: in the `starts` mode, with
// what ended it when it answers fewer rows than asked.
export const fetchPart = async (source, query, meter) => {
  const asked = { rows: query.rows, meter, bytes: query.documents.bytes };

  return query.documents.mode === STARTS
    ? fetchStarts(source, query, asked)
    : { documents: await fetchWhole(source, query, asked) };
};
