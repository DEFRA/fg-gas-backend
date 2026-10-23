import { config } from "../config.js";
import { logger } from "../logger.js";
import { db } from "../mongo-client.js";
import { STORED, keyOf, toIso, toStoredTime } from "./bucket.js";
import { decodeCursor, encodeCursor } from "./cursor.js";
import {
  BOUNDED,
  EXACT,
  REFS,
  SCAN_BUDGET,
  choosePlan,
  factsOf,
  fillOf,
  scansOf,
} from "./plan.js";
import { toRef } from "./refs.js";
import { refuse } from "./refusal.js";
import { findBucket, listBuckets } from "./registry.js";
import { TIMELINE_LIMIT, queryRequestSchema } from "./schema.js";

export const COUNT_CAP = 10_000;

// A summary counts one entry at a time, on an index line of its own, so it can
// afford to count further than a tile does.
export const SUMMARY_COUNT_CAP = 100_000;
export const MAX_VALUES = 100;

const MAX_TIME_MS_EXPIRED = 50;

export const readTimeoutMs = () => config.adminReadTimeoutMs;

const parseFilter = (bucket, name, value) => {
  if (!Object.hasOwn(bucket.facts, name)) {
    throw refuse("UNKNOWN_FACT");
  }

  return value;
};

const parseWhere = (bucket, where) =>
  Object.fromEntries(
    Object.entries(where).map(([name, value]) => [
      name,
      parseFilter(bucket, name, value),
    ]),
  );

// A link is a kind a record's timeline reads by; it is never offered as a search.
const declaresKind = (bucket, kind) =>
  Object.hasOwn(bucket.refs, kind) || bucket.links.includes(kind);

const parseRef = (bucket, text) => {
  if (text === undefined) {
    return { ref: null, refKind: null };
  }

  const colon = text.indexOf(":");
  const refKind = text.slice(0, Math.max(colon, 0));
  const ref = toRef(refKind, text.slice(colon + 1));

  if (!declaresKind(bucket, refKind) || !ref) {
    throw refuse("UNKNOWN_REF_KIND");
  }

  return { ref, refKind };
};

export const parseShow = (bucket, show) => {
  if (!show.every((name) => Object.hasOwn(bucket.facts, name))) {
    throw refuse("UNKNOWN_FACT");
  }

  return show;
};

const parseGroupBy = (bucket, groupBy) => {
  if (!groupBy.every((name) => bucket.groupings.includes(name))) {
    throw refuse("UNKNOWN_GROUPING");
  }

  return groupBy;
};

const parseCursor = (bucket, cursor) =>
  cursor === undefined ? null : decodeCursor(bucket, cursor);

export const parseRange = ({ from, to }) => {
  if (new Date(from) > new Date(to)) {
    throw refuse("INVALID_RANGE");
  }

  return { from, to };
};

export const parseQuery = (bucket, body) => {
  const where = parseWhere(bucket, body.where);
  const asked = Object.keys(where);
  const { ref, refKind } = parseRef(bucket, body.ref);
  const show = parseShow(bucket, body.show);

  return {
    where,
    asked,
    show,
    ref,
    refKind,
    groupBy: parseGroupBy(bucket, body.groupBy),
    cursor: parseCursor(bucket, body.cursor),
    ...parseRange(body),
    limit: body.limit,
    plan: choosePlan(bucket, asked, ref !== null, show),
  };
};

export const and = (parts) => {
  const kept = parts.filter((part) => Object.keys(part).length > 0);

  return kept.length ? { $and: kept } : {};
};

const leadsOnRefs = (plan) => plan.line === REFS;

const boundFacts = ({ bucket, query, plan }) =>
  factsOf(bucket, plan.line).filter((fact) => query.asked.includes(fact));

const boundPart = (read) =>
  Object.fromEntries(
    boundFacts(read).map((fact) => [fact, read.query.where[fact]]),
  );

const fillOfFact = ({ bucket, query }, fact, unset) => ({
  $in: [...fillOf(bucket, fact, query.show), ...unset],
});

const filledPart = (read, unset) =>
  Object.fromEntries(
    read.plan.filled.map((fact) => [fact, fillOfFact(read, fact, unset)]),
  );

const refPart = ({ query }) => (query.ref ? { refs: query.ref } : {});

const bounds = (bucket, entries) =>
  Object.fromEntries(
    entries
      .filter(([, value]) => value !== undefined)
      .map(([operator, value]) => [operator, toStoredTime(bucket, value)]),
  );

export const rangePart = ({ bucket, query }) => {
  const range = bounds(bucket, [
    ["$gte", query.from],
    ["$lte", query.to],
  ]);

  return Object.keys(range).length ? { [bucket.time.field]: range } : {};
};

// A residual nothing asked for is a fact that hides values: it is tested
// against the values it still shows, and null.
const residualOf = (read, fact) =>
  read.query.asked.includes(fact)
    ? read.query.where[fact]
    : fillOfFact(read, fact, [null]);

const residualPart = (read) =>
  Object.fromEntries(
    read.plan.residual.map((fact) => [fact, residualOf(read, fact)]),
  );

const keysetParts = ({ bucket, query: { cursor } }) =>
  cursor
    ? [
        { [bucket.time.field]: { $lte: cursor.t } },
        { $nor: [{ [bucket.time.field]: cursor.t, _id: { $gte: cursor.i } }] },
      ]
    : [];

const olderThanCursor = ({ bucket, query: { cursor } }) =>
  cursor ? { [bucket.time.field]: { $lt: cursor.t } } : {};

const positionOf = (bucket, doc) => ({ t: doc[bucket.time.field], i: doc._id });

const withinEdge = ({ bucket }, edge) => {
  if (!edge) {
    return [];
  }

  const { t, i } = positionOf(bucket, edge);

  return [
    { [bucket.time.field]: { $gte: t } },
    { $nor: [{ [bucket.time.field]: t, _id: { $lt: i } }] },
  ];
};

export const matchParts = (read) => [
  boundPart(read),
  filledPart(read, [null]),
  refPart(read),
  rangePart(read),
];

export const collectionOf = ({ bucket }) => db.collection(bucket.collection);

const timeLeft = ({ deadline }) => Math.max(1, deadline - Date.now());

export const readOptions = (read) => ({
  hint: keyOf(read.bucket, read.plan.line),
  maxTimeMS: timeLeft(read),
});

const findOptions = (read) => ({
  ...readOptions(read),
  sort: { [read.bucket.time.field]: -1, _id: -1 },
});

export const refuseTimedOut = (error) => {
  throw error.code === MAX_TIME_MS_EXPIRED ? refuse("TIMED_OUT") : error;
};

const readEdge = async (read) => {
  const [edge = null] = await collectionOf(read)
    .find(
      and([
        boundPart(read),
        filledPart(read, []),
        refPart(read),
        rangePart(read),
        olderThanCursor(read),
      ]),
      {
        ...findOptions(read),
        projection: { [read.bucket.time.field]: 1, _id: 1 },
        skip: SCAN_BUDGET - 1,
        limit: 1,
      },
    )
    .toArray()
    .catch(refuseTimedOut);

  return edge;
};

const readRows = (read, edge) =>
  collectionOf(read)
    .find(
      and([
        ...matchParts(read),
        ...keysetParts(read),
        residualPart(read),
        ...withinEdge(read, edge),
      ]),
      {
        ...findOptions(read),
        projection: {
          ...read.bucket.row.projection,
          [read.bucket.time.field]: 1,
        },
        limit: read.query.limit + 1,
      },
    )
    .toArray()
    .catch(refuseTimedOut);

const toRow = (bucket) => (doc) => ({
  id: String(doc._id),
  time: toIso(doc[bucket.time.field]),
  ...bucket.row.present(doc),
});

const endOfPage = { next: null, keepLooking: null, searchedTo: null };

const pageAfter = (bucket, last) => ({
  ...endOfPage,
  next: encodeCursor(positionOf(bucket, last)),
  complete: false,
});

const pageWithin = (bucket, edge) =>
  edge
    ? {
        ...endOfPage,
        keepLooking: encodeCursor(positionOf(bucket, edge)),
        searchedTo: toIso(edge[bucket.time.field]),
        complete: false,
      }
    : { ...endOfPage, complete: true };

const isBounded = ({ plan }) => plan.kind === BOUNDED;

const readPage = async (read) => {
  const { bucket, query } = read;
  const edge = isBounded(read) ? await readEdge(read) : null;
  const docs = await readRows(read, edge);
  const kept = docs.slice(0, query.limit);

  return {
    rows: kept.map(toRow(bucket)),
    page:
      docs.length > query.limit
        ? pageAfter(bucket, kept.at(-1))
        : pageWithin(bucket, edge),
  };
};

export const readCount = async (read, cap = COUNT_CAP) => {
  const found = await collectionOf(read)
    .countDocuments(and(matchParts(read)), {
      ...readOptions(read),
      limit: cap + 1,
    })
    .catch(refuseTimedOut);

  return { count: Math.min(found, cap), capped: found > cap };
};

const leadLine = (bucket, fact) =>
  bucket.indexes.find((line) => line[0] === fact);

export const readStoredValues = async (bucket, fact, maxTimeMS) => {
  const groups = await db
    .collection(bucket.collection)
    .aggregate([{ $group: { _id: `$${fact}` } }, { $limit: MAX_VALUES + 1 }], {
      hint: keyOf(bucket, leadLine(bucket, fact)),
      maxTimeMS,
    })
    .toArray()
    .catch(refuseTimedOut);

  const values = groups
    .map(({ _id }) => _id)
    .filter((value) => value !== null)
    .sort((a, b) => String(a).localeCompare(String(b)));

  return values.length > MAX_VALUES ? null : values;
};

const valuesOf = (bucket, fact, maxTimeMS) =>
  bucket.facts[fact].values === STORED
    ? readStoredValues(bucket, fact, maxTimeMS)
    : bucket.facts[fact].values.map(({ value }) => value);

const countValue = (read, asked, fact) => async (value) => ({
  value,
  ...(await readCount({
    ...read,
    query: {
      ...read.query,
      asked,
      where: { ...read.query.where, [fact]: value },
    },
  })),
});

const countValues = async (read, asked, fact) => {
  const values = await valuesOf(read.bucket, fact, timeLeft(read));

  return values && Promise.all(values.map(countValue(read, asked, fact)));
};

const planOf = ({ bucket, query }, asked) =>
  choosePlan(bucket, asked, query.ref !== null, query.show);

const readGroupValues = (read, others, fact) => {
  const asked = [...others, fact];
  const plan = planOf(read, asked);

  return plan.kind === EXACT
    ? countValues({ ...read, plan }, asked, fact)
    : null;
};

// The list with the group's own filter left out: what the All tile counts.
const readGroupTotal = (read, others) => {
  const plan = planOf(read, others);

  return plan.kind === EXACT
    ? readCount({ ...read, plan, query: { ...read.query, asked: others } })
    : null;
};

const readGroup = (read) => async (fact) => {
  const others = read.query.asked.filter((name) => name !== fact);
  const [values, total] = await Promise.all([
    readGroupValues(read, others, fact),
    readGroupTotal(read, others),
  ]);

  return { by: fact, values, total };
};

const describePlan = (read) => ({
  kind: read.plan.kind,
  index: Object.keys(keyOf(read.bucket, read.plan.line)),
  bound: [...boundFacts(read), ...(leadsOnRefs(read.plan) ? ["ref"] : [])],
  filled: read.plan.filled,
  residual: read.plan.residual,
  scans: scansOf(
    read.bucket,
    read.plan.line,
    read.query.asked,
    read.query.show,
  ),
});

const logBounded = ({ bucket, query, plan }) => {
  if (plan.kind === BOUNDED) {
    logger.info(
      `Bucket ${bucket.id} bounded read: asked [${query.asked.join(", ")}], lead [${[plan.line].flat().join(", ")}]`,
    );
  }
};

export const runQuery = async (bucket, query) => {
  const read = {
    bucket,
    query,
    plan: query.plan,
    deadline: Date.now() + readTimeoutMs(),
  };

  logBounded(read);

  const [{ rows, page }, groups] = await Promise.all([
    readPage(read),
    Promise.all(query.groupBy.map(readGroup(read))),
  ]);

  return {
    bucket: bucket.id,
    plan: describePlan(read),
    rows,
    page,
    groups,
  };
};

const readTimelineOf = (ref) => async (bucket) => {
  const { id, label } = bucket;

  try {
    const { value } = queryRequestSchema.validate({
      ref,
      limit: TIMELINE_LIMIT,
    });
    const { rows, page } = await runQuery(bucket, parseQuery(bucket, value));

    return { id, label, rows, more: page.next !== null };
  } catch (error) {
    logger.error(`Timeline: ${id} could not be read (${error.name})`);

    return { id, label, rows: null, more: false };
  }
};

// A record's events: its ref searched in every timeline bucket this service
// registers, each answered apart so one that fails takes none with it.
export const readTimeline = async (ref) => ({
  buckets: await Promise.all(
    listBuckets()
      .filter(({ timeline }) => timeline)
      .map(readTimelineOf(ref)),
  ),
});

// One bucket's rows for a link only it declares, read as a timeline bucket is.
export const readBucketTimeline = async (id, ref) => ({
  buckets: [await readTimelineOf(ref)(findBucket(id))],
});
