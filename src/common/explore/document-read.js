import { BSON } from "mongodb";
import { SECONDARY, and, matchParts } from "../buckets/engine.js";
import { choosePlan } from "../buckets/plan.js";
import { copyOf, elementsOf, valueKeyOf } from "./bson-bytes.js";
import {
  DOC,
  documentProjectionOf,
  positionFieldsOf,
  positionKey,
  unwindStagesOf,
} from "./document-projection.js";
import { SIZE_ERROR, SIZE_PATTERN } from "./evaluate.js";
import { step, timeLeftOf } from "./meter.js";
import { readCollection } from "./read-only.js";
import { refusalOf, refuseQuery } from "./refusal.js";
import { readFailed } from "./run-box.js";

export const TEST = "f";
const KEY = "k";
const ID_HINT = { _id: 1 };

// Rows fetched in one aggregate, so its $in and $or stay short.
export const CHUNK = 50;

// Results a reply holds at most: each can be 16 MiB, and mongod's reply
// holds 16 MiB at most whatever the count.
const BATCH = 20;

const TOO_LARGE = 10_334;
const SIZE_FAILED = 17_124;

export const UNPARSED = {
  promoteValues: false,
  bsonRegExp: true,
  validation: { utf8: false },
};

export const rowKeyOf = (idKey, at) =>
  `${idKey}|${at.map((n) => (n === null ? "-" : n)).join(",")}`;

// ── One aggregate ──

const idMatchOf = (rows) => ({
  _id: { $in: [...new Map(rows.map((row) => [row.idKey, row.id])).values()] },
});

// After the nth $unwind, the rows whose positions so far are asked for.
const prefixMatchOf = (rows) => (n) => ({
  $or: [
    ...new Map(
      rows.map((row) => [
        rowKeyOf(row.idKey, row.at.slice(0, n + 1)),
        Object.fromEntries([
          [`${DOC}._id`, row.id],
          ...row.at.slice(0, n + 1).map((at, m) => [positionKey(m), at]),
        ]),
      ]),
    ).values(),
  ],
});

// The record wrapped as `d`, and, when the filter is tested again, its
// filter's paths projected as `f` beside it.
const isTesting = (testing) => Object.keys(testing).length > 0;

const wrapStagesOf = (testing) =>
  isTesting(testing)
    ? [
        { $replaceWith: { [DOC]: "$$ROOT", [TEST]: "$$ROOT" } },
        { $project: { [DOC]: 1, ...testing } },
      ]
    : [{ $replaceWith: { [DOC]: "$$ROOT" } }];

const keptBeside = (testing) => (isTesting(testing) ? [KEY, TEST] : [KEY]);

const keyStageOf = (query, testing) => ({
  $replaceWith: {
    [KEY]: { id: `$${DOC}._id`, p: positionFieldsOf(query.unwind) },
    [DOC]: `$${DOC}`,
    ...(isTesting(testing) && { [TEST]: `$${TEST}` }),
  },
});

const projectStagesOf = (query, testing) => {
  const projection = documentProjectionOf(query, keptBeside(testing));

  return projection ? [{ $project: projection }] : [];
};

const pipelineOf = ({ query, line, testing }, rows) => [
  { $match: and([idMatchOf(rows), line]) },
  ...wrapStagesOf(testing),
  ...unwindStagesOf(query.unwind, prefixMatchOf(rows)),
  keyStageOf(query, testing),
  ...projectStagesOf(query, testing),
];

const INT64 = 0x12;
const INT32 = 0x10;

const positionOfElement = (buf, { type, start }) => {
  if (type === INT64) {
    return Number(buf.readBigInt64LE(start));
  }

  return type === INT32 ? buf.readInt32LE(start) : null;
};

const byName = (elements) =>
  new Map(elements.map((element) => [element.name, element]));

const decoded = (buf, element) =>
  BSON.deserialize(copyOf(buf, element), UNPARSED);

// One raw result: its row's key, the document's bytes (still in the reply)
// and what the filter is tested on.
const resultOf = (buf) => {
  const parts = byName(elementsOf(buf));
  const key = byName(elementsOf(buf, parts.get(KEY).start));
  const at = elementsOf(buf, key.get("p").start).map((element) =>
    positionOfElement(buf, element),
  );
  const test = parts.get(TEST);

  return {
    key: rowKeyOf(valueKeyOf(buf, key.get("id")), at),
    doc: buf.subarray(parts.get(DOC).start, parts.get(DOC).end),
    test: test ? decoded(buf, test) : null,
  };
};

const isTooLarge = (error) => error?.code === TOO_LARGE;

// mongod's own failure of $size fails the query, in its words: only the
// type it names is read from it.
const messageOf = (error) => String(error.errmsg ?? error.message);

const sizeTypeOf = (error) => {
  const named =
    error?.code === SIZE_FAILED ? SIZE_PATTERN.exec(messageOf(error)) : null;

  return named ? named[1] : null;
};

// mongod reads for the time left, less what a starts fetch keeps back.
const readOptions = (meter, reserve = 0) => ({
  raw: true,
  hint: ID_HINT,
  readPreference: SECONDARY,
  maxTimeMS: Math.max(1, timeLeftOf(meter) - reserve),
  allowDiskUse: false,
  batchSize: BATCH,
});

// A joined record is found by its keys, through its collection's own
// indexes.
export const joinedOptions = (meter, reserve) => {
  const { hint, ...options } = readOptions(meter, reserve);

  return options;
};

const KIB = 1024;

// Each record fetched is charged to the meter by its size.
export const costOf = (bytes) => 1 + Math.floor(bytes / KIB);

export const chargedByStored = async (meter, { bytes, keep }) => {
  await step(meter, costOf(bytes));
  keep();
};

// A starts fetch keeps this much of the request's time back, to answer in.
export const START_RESERVE_MS = 1000;

export const checkReserve = (meter, reserve) => {
  if (reserve > 0 && timeLeftOf(meter) <= reserve) {
    throw refuseQuery("TOO_SLOW");
  }
};

// A record's start is charged by the bytes kept, so a large record costs no
// more than a small one; its read is bounded by the deadline.
export const chargedByKept = async (meter, { keep }) => {
  checkReserve(meter, START_RESERVE_MS);

  await step(meter, costOf(keep() ?? 0), true);

  if (meter.spent > meter.budget) {
    throw refuseQuery("TOO_COSTLY");
  }
};

export const closing = async (cursor, each) => {
  try {
    for await (const buf of cursor) {
      await each(buf);
    }
  } finally {
    await cursor.close();
  }
};

const readAll = async (plan, pipeline, meter, each) => {
  checkReserve(meter, plan.reserve);

  return closing(
    plan.collection.aggregate(pipeline, readOptions(meter, plan.reserve)),
    each,
  );
};

const countColumnsOf = (query) =>
  query.columns.filter((column) => column.fn === "count");

const failsOn = async (plan, rows, meter, column) => {
  const probe = {
    ...plan,
    testing: {},
    query: {
      ...plan.query,
      columns: [column],
      documents: { whole: false, id: true },
    },
  };

  try {
    await readAll(probe, pipelineOf(probe, rows), meter, () => {});

    return false;
  } catch (error) {
    return sizeTypeOf(error) !== null;
  }
};

const firstFailing = async (plan, rows, meter, columns) => {
  for (const column of columns) {
    if (await failsOn(plan, rows, meter, column)) {
      return column;
    }
  }

  return null;
};

// The column mongod failed on, as the evaluator names it: the first, in
// the query's order, whose $size fails on these rows.
const failedColumnOf = async (plan, rows, meter) => {
  const counts = countColumnsOf(plan.query);
  const failed =
    counts.length > 1
      ? await firstFailing(plan, rows, meter, counts)
      : (counts[0] ?? null);

  return failed ? plan.query.columns.indexOf(failed) : null;
};

const failureOf = async (error, plan, rows, meter) => {
  if (isTooLarge(error) || refusalOf(error)) {
    return error;
  }

  const type = sizeTypeOf(error);

  return type
    ? refuseQuery(SIZE_ERROR, {
        fn: "count",
        type,
        column: await failedColumnOf(plan, rows, meter),
      })
    : readFailed(error);
};

const placesOf = (rows) => {
  const places = new Map();

  rows.forEach((row) =>
    places.set(row.key, [...(places.get(row.key) ?? []), row.n]),
  );

  return places;
};

// Each result is handed to `take` by its row's place in the order asked,
// at every place a row asked more than once has, each charged.
const aggregated = async (plan, rows, meter, take) => {
  const places = placesOf(rows);

  try {
    await readAll(plan, pipelineOf(plan, rows), meter, async (buf) => {
      const result = resultOf(buf);

      for (const n of places.get(result.key) ?? []) {
        await plan.charged(meter, {
          bytes: buf.length,
          keep: () => take(n, result),
        });
      }
    });
  } catch (error) {
    throw await failureOf(error, plan, rows, meter);
  }
};

const rowFilterOf = (plan, row) => and([{ _id: row.id }, plan.line]);

const testFindOf = (testing) =>
  Object.fromEntries(
    Object.keys(testing).map((path) => [path.slice(TEST.length + 1), 1]),
  );

// What the filter is tested on for one row fetched without it.
const testOf = async (plan, row, meter) => {
  if (!isTesting(plan.testing)) {
    return null;
  }

  const [found] = await plan.collection
    .find(rowFilterOf(plan, row), {
      ...readOptions(meter, plan.reserve),
      raw: false,
      ...UNPARSED,
      projection: testFindOf(plan.testing),
      limit: 1,
    })
    .toArray()
    .catch(readFailed);

  return found ?? null;
};

const failedFor = (plan, row, meter) => async (error) => {
  throw await failureOf(error, plan, [row], meter);
};

// A whole record mongod can't wrap, read as it is.
const readWhole = async (plan, row, meter) => {
  const [buf] = await plan.collection
    .find(rowFilterOf(plan, row), {
      ...readOptions(meter, plan.reserve),
      projection: plan.query.documents.id ? undefined : { _id: 0 },
      limit: 1,
    })
    .toArray()
    .catch(failedFor(plan, row, meter));

  return buf ? { key: row.key, doc: Buffer.from(buf), test: null } : null;
};

// One row read again without what the fetch wraps around it.
const readBare = async (plan, row, meter) => {
  let found = null;

  await aggregated({ ...plan, testing: {} }, [row], meter, (_, result) => {
    found = result;
  });

  return found;
};

const isPlainWhole = ({ query }) =>
  query.documents.whole && query.unwind.length === 0;

// One row too large for mongod's reply with what the fetch wraps around it:
// again without the filter's test, then as the record itself where it is
// whole, the filter tested on its paths read alone; else its document is
// too large to make.
const triesOf = (plan) => [
  ...(isTesting(plan.testing) ? [readBare] : []),
  ...(isPlainWhole(plan) ? [readWhole] : []),
];

// What a read gives, or null where mongod's reply would be too large.
const unlessTooLarge = async (attempt) => {
  try {
    return await attempt();
  } catch (error) {
    if (!isTooLarge(error)) {
      throw error;
    }

    return null;
  }
};

const withTestOf = async (plan, row, meter, result) =>
  result && { ...result, test: await testOf(plan, row, meter) };

const fetchAlone = async (plan, row, meter, take) => {
  for (const attempt of triesOf(plan)) {
    const found = await unlessTooLarge(() => attempt(plan, row, meter));

    if (found !== null) {
      take(row.n, await withTestOf(plan, row, meter, found));

      return;
    }
  }

  take(row.n, { tooLarge: true, doc: Buffer.alloc(0) });
};

// A row of a chunk too large for one reply, unless it was let go since:
// alone in a chunk of its own, then alone as fetchAlone reads it.
const fetchOne = (plan, row, ctx, inChunk) => {
  if (!ctx.holder.admits(row.n)) {
    return null;
  }

  return inChunk
    ? fetchChunk(plan, [row], ctx)
    : fetchAlone(plan, row, ctx.meter, ctx.take);
};

// A chunk too large for one reply is read a row at a time, each still held
// when its turn comes.
export const fetchChunk = async (plan, rows, ctx) => {
  const { meter, take } = ctx;
  const read = await unlessTooLarge(async () => {
    await aggregated(plan, rows, meter, take);

    return true;
  });

  if (read) {
    return;
  }

  for (const row of rows) {
    await fetchOne(plan, row, ctx, rows.length > 1);
  }
};

export const chunksOf = (rows) =>
  Array.from({ length: Math.ceil(rows.length / CHUNK) }, (_, n) =>
    rows.slice(n * CHUNK, (n + 1) * CHUNK),
  );

// ── One box ──

// The bucket line's filled facts, so a record no longer in the box's
// bucket is never fetched through it.
const lineOf = (box) =>
  box.bucket
    ? and(
        matchParts({
          bucket: box.bucket,
          query: { asked: [], ref: null },
          plan: choosePlan(box.bucket, [], false),
        }),
      )
    : {};

const boxCollectionOf = (box) =>
  readCollection(box.bucket ? box.bucket.collection : box.collection);

export const planOf = (box, { query, testing, reserve, charged }) => ({
  collection: boxCollectionOf(box),
  query,
  line: lineOf(box),
  testing,
  reserve,
  charged,
});

export const fetchBox = async (box, rows, ctx) => {
  const plan = planOf(box, ctx);

  for (const chunk of chunksOf(rows)) {
    const admitted = chunk.filter(({ n }) => ctx.holder.admits(n));

    if (admitted.length) {
      await fetchChunk(plan, admitted, ctx);
    }
  }
};
