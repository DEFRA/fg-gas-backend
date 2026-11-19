import { decodeCursor } from "../buckets/cursor.js";
import {
  COUNT_CAP,
  MAX_TIME_MS_EXPIRED,
  SECONDARY,
  and,
  collectionOf,
  findOptions,
  keysetParts,
  matchParts,
  residualPart,
  timeLeft,
  withinEdge,
} from "../buckets/engine.js";
import { SCAN_BUDGET } from "../buckets/plan.js";
import { compileWhere, plainValue } from "./evaluate.js";
import {
  projectionOf,
  readPathsOf,
  readersFor,
  usedReaders,
} from "./fields.js";
import { compareRows } from "./merge.js";
import { chargeWork, eachStep, freely, step } from "./meter.js";
import { testsOf } from "./query-schema.js";
import { refusalOf, refuseQuery } from "./refusal.js";
import { rowMaker, unwinder } from "./rows.js";

export const WINDOW = 5_000;
export const SORT_CAP = 5_000;
export const GROUP_CAP = SCAN_BUDGET;
export const FULL_CAP = SCAN_BUDGET;

// A server error may quote the filter, and with it a value asked for, so only
// its code is passed on.
export const readFailed = (error) => {
  if (error.code === MAX_TIME_MS_EXPIRED) {
    throw refuseQuery("TOO_SLOW");
  }

  throw Object.assign(new Error("Explore read failed"), {
    name: error.name,
    code: error.code,
    codeName: error.codeName,
  });
};

// No order is newest first, as the bucket reads.
export const isDefaultOrder = (orderBy) => orderBy === null;

const isTimeAscending = (orderBy, time) =>
  orderBy?.path === time && !orderBy.fn && !orderBy.desc;

const sortsInMongo = (orderBy, time) =>
  isDefaultOrder(orderBy) || isTimeAscending(orderBy, time);

// ── One box ──

export const boxContext = (source, box, query, lens) => {
  const readers = readersFor(source, lens);

  return {
    box,
    readers,
    make: rowMaker({
      query,
      readerOf: readers.readerOf,
      open: source.open,
      timeNames: [box.bucket.time.field],
    }),
    unwound: unwinder({ query, readerOf: readers.readerOf }),
    projection: projectionOf([
      ...readPathsOf(usedReaders(query, readers)),
      ...source.openPaths,
      box.bucket.time.field,
    ]),
  };
};

export const positionOfBox = (box, positions) => {
  if (!positions || !Object.hasOwn(positions, box.id)) {
    return undefined;
  }

  return positions[box.id];
};

const decodedPosition = (box, cursor) => {
  try {
    return cursor === undefined ? null : decodeCursor(box.bucket, cursor);
  } catch {
    throw refuseQuery("BAD_POSITION");
  }
};

export const engineRead = (planned, cursor, meter) => ({
  bucket: planned.bucket,
  query: { ...planned.query, cursor },
  plan: planned.plan,
  recheck: planned.recheck,
  deadline: meter.deadline,
});

const LENGTH_STEP = 20;

const lengthCost = (values) =>
  1 +
  Math.floor(
    Math.max(0, ...values.map((v) => String(plainValue(v)).length)) /
      LENGTH_STEP,
  );

// A pattern is charged the steps it takes, as it takes them.
const valuesCost = ({ op, values }) =>
  op === "regex" ? 1 : Math.max(1, values.length) * lengthCost(values);

// The value comparisons one record's residual makes: each test's values,
// times how long they are.
export const costOf = (where) =>
  testsOf(where).reduce((cost, test) => cost + valuesCost(test), 1);

const filterOf = (read) =>
  and([...matchParts(read), residualPart(read), read.recheck ?? {}]);

// Small batches, so no one batch of records holds the event loop long.
const BATCH = 200;

const options = (read, extra) => ({
  ...findOptions(read),
  readPreference: SECONDARY,
  allowDiskUse: false,
  batchSize: BATCH,
  ...extra,
});

export const countBox = async (read, cap) => {
  const found = await collectionOf(read)
    .countDocuments(filterOf(read), {
      hint: findOptions(read).hint,
      maxTimeMS: timeLeft(read),
      readPreference: SECONDARY,
      limit: cap + 1,
    })
    .catch(readFailed);

  return { n: Math.min(found, cap), capped: found > cap };
};

// The edge read's keyset as $or of index ranges, not a range and a $nor:
// Mongo answers it from the index keys alone, so it fetches no record. The
// window read keeps the range and the $nor: it fetches its records anyway,
// and the range bounds its scan at both ends.
const olderThan = (field, { t, i }) => ({
  $or: [{ [field]: { $lt: t } }, { [field]: t, _id: { $lt: i } }],
});

const keysetOf = (read) =>
  read.query.cursor
    ? [olderThan(read.bucket.time.field, read.query.cursor)]
    : [];

export const readEdge = async (read) => {
  const [edge = null] = await collectionOf(read)
    .find(
      and([filterOf(read), ...keysetOf(read)]),
      options(read, {
        projection: { [read.bucket.time.field]: 1, _id: 1 },
        skip: WINDOW - 1,
        limit: 1,
      }),
    )
    .toArray()
    .catch(readFailed);

  return edge;
};

const isMongoError = (error) => !error.refusal;

const isFree = (read, firstFree) => firstFree && read === 0;

// `firstFree`: the first record is read whatever the budget has left.
const takeEach = async (cursor, take, meter, cost, firstFree = false) => {
  let read = 0;

  for await (const doc of cursor) {
    const free = isFree(read, firstFree);

    read += 1;
    await step(meter, cost, free);

    if (!(await take(doc, free))) {
      return;
    }
  }
};

const failedRead = (error) => {
  throw isMongoError(error) ? readFailed(error) : error;
};

// Each record read in order, metered, until `take` says to stop.
export const eachDoc = (cursor, take, meter, cost, firstFree) =>
  takeEach(cursor, take, meter, cost, firstFree)
    .catch(failedRead)
    .finally(() => cursor.close());

const ascending = (read) => ({
  sort: { [read.bucket.time.field]: 1, _id: 1 },
});

export const findDocs = (read, context, extra = {}) =>
  collectionOf(read).find(
    filterOf(read),
    options(read, { projection: context.projection, ...extra }),
  );

const keyOf = (bucket, doc) => ({
  t: new Date(doc[bucket.time.field]).toISOString(),
  i: String(doc._id),
});

export const emptyBox = (box, end = true) => ({
  id: box.id,
  rows: [],
  to: null,
  end,
  count: { n: 0, capped: false },
});

// ── Windowed ──

// A window that ran out of work ends at the last record it read. When even
// its first record is more than one request can afford to search, that
// record is skipped: the window ends just past it and says so, so Keep
// looking always moves on. Its rows are those found so far.
const endsAt = (found) =>
  found.lastRead
    ? { doc: found.lastRead, skipped: 0 }
    : { doc: found.current, skipped: 1 };

const endedEarly = (box, found, error) => {
  if (refusalOf(error) !== "TOO_COSTLY" || !found.current) {
    throw error;
  }

  const { doc, skipped } = endsAt(found);

  return {
    id: box.id,
    rows: found.rows,
    to: keyOf(box.bucket, doc),
    end: false,
    count: null,
    partial: true,
    skipped,
  };
};

const tested = (meter, test, doc, box, free) =>
  free ? freely(meter, () => test(doc, box)) : test(doc, box);

export const readWindow = async (context, planned, query, meter) => {
  const { box } = context;
  const read = engineRead(
    planned,
    decodedPosition(box, positionOfBox(box, query.positions)),
    meter,
  );
  const edge = await readEdge(read);
  const test = compileWhere(
    planned.residual,
    context.readers.readerOf,
    chargeTo(meter),
  );
  const found = { rows: [], lastRead: null, current: null };
  const { rows } = found;
  let last = null;

  try {
    await eachDoc(
      collectionOf(read).find(
        and([filterOf(read), ...keysetParts(read), ...withinEdge(read, edge)]),
        options(read, { projection: context.projection }),
      ),
      (doc, free) => {
        found.current = doc;

        if (tested(meter, test, doc, box, free)) {
          rows.push(context.make(doc, box));
          last = doc;
        }

        found.lastRead = doc;

        return rows.length < query.limit;
      },
      meter,
      costOf(planned.residual),
      true,
    );
  } catch (error) {
    return endedEarly(box, found, error);
  }

  const full = rows.length === query.limit;
  const end = full ? last : edge;

  return {
    id: box.id,
    rows,
    to: end ? keyOf(box.bucket, end) : null,
    end: !end,
    count: null,
  };
};

// A pattern's work is charged as it does it, and may stop it there.
export const chargeTo = (meter) => (units) => chargeWork(meter, units);

// ── Exact ──

// Records shaped into rows a few at a time, so a long answer never holds the
// event loop: each row costs its columns.
export const shaped = async (docs, make, box, meter, cost) => {
  const rows = [];

  await eachStep(docs, meter, cost, (doc) => rows.push(make(doc, box)));

  return rows;
};

export const shapeCost = (query) => query.columns.length;

const readSorted = async (read, context, query, meter) => {
  const { capped } = await countBox(read, SORT_CAP);

  if (capped) {
    throw refuseQuery("TOO_MANY_TO_SORT");
  }

  const docs = await findDocs(read, context).toArray().catch(readFailed);

  return shaped(docs, context.make, context.box, meter, shapeCost(query));
};

const readNewest = async (read, context, query, meter) => {
  const extra = isTimeAscending(query.orderBy, read.bucket.time.field)
    ? ascending(read)
    : {};
  const docs = await findDocs(read, context, { ...extra, limit: query.limit })
    .toArray()
    .catch(readFailed);

  return shaped(docs, context.make, context.box, meter, shapeCost(query));
};

const readExact = async (context, planned, query, meter) => {
  const read = engineRead(planned, null, meter);
  const readRows = sortsInMongo(query.orderBy, read.bucket.time.field)
    ? readNewest
    : readSorted;
  const [rows, count] = await Promise.all([
    readRows(read, context, query, meter),
    countBox(read, COUNT_CAP),
  ]);

  return { id: context.box.id, rows, to: null, end: true, count };
};

// ── $unwind ──

export const isUnwinding = (query) => Boolean(query.unwind?.length);

// Each row a record unwinds to, each a step charged as a row is shaped: a
// record with a huge list stops at the work budget, not at memory, and lets
// other requests in as it goes.
export const eachUnwound = (unwound, query, meter, take) => {
  if (!isUnwinding(query)) {
    return take;
  }

  const cost = 1 + shapeCost(query);

  return async (doc) => {
    for (const one of unwound(doc)) {
      await step(meter, cost);
      take(one);
    }
  };
};

// Unwinding can make more groups than records: as many as the cap at most.
export const checkGroups = (groups) => {
  if (groups.size() > GROUP_CAP) {
    throw refuseQuery("TOO_MANY_TO_COUNT");
  }
};

// Unwound rows kept to the best `limit`: sorted and cut each time twice that
// many are held, so a long unwind never holds more. Rows a read gives in
// their order are kept until there are enough.
const keptRows = (query, inOrder) => {
  const rows = [];
  const cut = () => {
    rows.sort(compareRows(query.orderBy));
    rows.splice(query.limit);
  };

  return {
    wants: () => !inOrder || rows.length < query.limit,
    add: (row) => {
      rows.push(row);

      if (rows.length >= 2 * query.limit) {
        cut();
      }
    },
    rows: () => {
      cut();

      return rows;
    },
  };
};

export const unwoundRows = (query, make, inOrder) => {
  const kept = keptRows(query, inOrder);
  let n = 0;

  return {
    take: (one, box) => {
      n += 1;

      if (kept.wants()) {
        kept.add(make(one, box));
      }
    },
    answer: () => ({ rows: kept.rows(), count: { n, capped: false } }),
  };
};

// Rows of unwound records read exact, once every box's records are counted
// together, as for groups: each read and unwound in the read's own order.
const readUnwound = async (context, planned, query, meter) => {
  const read = engineRead(planned, null, meter);
  const found = unwoundRows(
    query,
    context.make,
    sortsInMongo(query.orderBy, read.bucket.time.field),
  );
  const take = eachUnwound(context.unwound, query, meter, (one) =>
    found.take(one, context.box),
  );
  const extra = isTimeAscending(query.orderBy, read.bucket.time.field)
    ? ascending(read)
    : {};

  await eachDoc(
    findDocs(read, context, { ...extra, limit: GROUP_CAP + 1 }),
    async (doc) => {
      await take(doc);

      return true;
    },
    meter,
    1,
  );

  return { id: context.box.id, to: null, end: true, ...found.answer() };
};

export const readBox = (context, planned, query, meter) =>
  isUnwinding(query)
    ? readUnwound(context, planned, query, meter)
    : readExact(context, planned, query, meter);
