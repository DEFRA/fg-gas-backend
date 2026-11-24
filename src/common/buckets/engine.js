import { logger } from "../logger.js";
import { db } from "../mongo-client.js";
import { readTimeoutMs } from "../read-timeout.js";
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

export const COUNT_CAP = 10_000;

// A summary counts one entry at a time, on an index line of its own, so it can
// afford to count further than a tile does.
export const SUMMARY_COUNT_CAP = 100_000;
export const MAX_VALUES = 100;

export const MAX_TIME_MS_EXPIRED = 50;

// Lists and Explore read from a secondary where there is one.
export const SECONDARY = "secondaryPreferred";

export { readTimeoutMs };

const offersValues = (fact) =>
  Array.isArray(fact.values) || fact.values === STORED;

// Several values are one of them; one given as a list is that value.
const parseValues = (fact, value) => {
  if (!offersValues(fact)) {
    throw refuse("SINGLE_VALUE_FACT");
  }

  const values = [...new Set(value)];

  return values.length === 1 ? values[0] : values;
};

const parseFilter = (bucket, name, value) => {
  if (!Object.hasOwn(bucket.facts, name)) {
    throw refuse("UNKNOWN_FACT");
  }

  return Array.isArray(value) ? parseValues(bucket.facts[name], value) : value;
};

const listOf = (value) => [value].flat();

const isAmong = ({ where, asked }, among) =>
  Object.entries(among).every(
    ([fact, allowed]) =>
      asked.includes(fact) &&
      listOf(where[fact]).every((value) => allowed.includes(value)),
  );

// The value a row holding none of `fact` is read as, or null: a fact's
// `nullAs` applies only while the facts its `among` names are asked for and
// hold only values listed there.
export const nullAsOf = (bucket, query, fact) => {
  const { nullAs } = bucket.facts[fact];

  return nullAs && isAmong(query, nullAs.among) ? nullAs.value : null;
};

// The fact whose asked values include the one rows holding it are read as.
const unkeyedFact = ({ bucket, query }) =>
  query.asked.find((name) => {
    const { nullAs } = bucket.facts[name];

    return nullAs && listOf(query.where[name]).includes(nullAs.value);
  });

const keptOf = (values) => (values.length === 1 ? values[0] : values);

const amongWhere = (where, among) =>
  Object.entries(among).map(([fact, allowed]) => [
    fact,
    Object.hasOwn(where, fact)
      ? listOf(where[fact]).filter((value) => allowed.includes(value))
      : allowed,
  ]);

// Rows holding the value are read at any value of the other facts; rows holding
// none, as a second read on the same line, only among those `among` names.
const unkeyedRead = (read) => {
  const fact = unkeyedFact(read);

  if (!fact) {
    return null;
  }

  const among = amongWhere(
    read.query.where,
    read.bucket.facts[fact].nullAs.among,
  );

  if (among.some(([, values]) => values.length === 0)) {
    return null;
  }

  const where = {
    ...read.query.where,
    [fact]: null,
    ...Object.fromEntries(
      among.map(([name, values]) => [name, keptOf(values)]),
    ),
  };
  const asked = Object.keys(where);
  const onLine = factsOf(read.bucket, read.plan.line);

  return {
    ...read,
    query: { ...read.query, where, asked },
    plan: {
      ...read.plan,
      filled: read.plan.filled.filter((name) => !asked.includes(name)),
      residual: asked.filter((name) => !onLine.includes(name)),
    },
  };
};

// What a read picks out: its parts, or with a second read for rows holding
// none, either read's, each whole so each reads its own index bounds.
export const pickedBy = (read, partsOf) => {
  const unkeyed = unkeyedRead(read);

  return unkeyed
    ? { $or: [and(partsOf(read)), and(partsOf(unkeyed))] }
    : and(partsOf(read));
};

// How many values each asked fact holds, for the scans a key would take.
export const widthsOf = (_bucket, query) =>
  Object.fromEntries(
    query.asked.map((name) => [name, listOf(query.where[name]).length]),
  );

const matchOf = (value) => (Array.isArray(value) ? { $in: value } : value);

const matchAsked = ({ query }, fact) => matchOf(query.where[fact]);

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

export const parseShow = (bucket, show = []) => {
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
  // Read and ignored, so an admin that sends it isn't refused.
  parseShow(bucket, body.show);

  return {
    where,
    asked,
    ref,
    refKind,
    groupBy: parseGroupBy(bucket, body.groupBy),
    count: body.count === true,
    cursor: parseCursor(bucket, body.cursor),
    ...parseRange(body),
    limit: body.limit,
    plan: choosePlan(
      bucket,
      asked,
      ref !== null,
      widthsOf(bucket, { where, asked }),
    ),
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
    boundFacts(read).map((fact) => [fact, matchAsked(read, fact)]),
  );

const fillOfFact = ({ bucket }, fact, unset) => ({
  $in: [...fillOf(bucket, fact), ...unset],
});

const filledPart = (read, unset) =>
  Object.fromEntries(
    read.plan.filled.map((fact) => [fact, fillOfFact(read, fact, unset)]),
  );

// One ref, or several, which the index reads as one scan each.
const refPart = ({ query }) => (query.ref ? { refs: matchOf(query.ref) } : {});

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

// A residual is an asked fact the line doesn't hold, tested row by row.
export const residualPart = (read) =>
  Object.fromEntries(
    read.plan.residual.map((fact) => [fact, matchAsked(read, fact)]),
  );

export const keysetParts = ({ bucket, query: { cursor } }) =>
  cursor
    ? [
        { [bucket.time.field]: { $lte: cursor.t } },
        { $nor: [{ [bucket.time.field]: cursor.t, _id: { $gte: cursor.i } }] },
      ]
    : [];

const olderThanCursor = ({ bucket, query: { cursor } }) =>
  cursor ? { [bucket.time.field]: { $lt: cursor.t } } : {};

const positionOf = (bucket, doc) => ({ t: doc[bucket.time.field], i: doc._id });

export const withinEdge = ({ bucket }, edge) => {
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

// A read of the rows `where` picks out, with no ref, on the plan given.
export const readOn = (bucket, { where, from, to }, plan) => ({
  bucket,
  query: { where, asked: Object.keys(where), ref: null, from, to },
  plan,
  deadline: Date.now() + readTimeoutMs(),
});

export const timeLeft = ({ deadline }) => Math.max(1, deadline - Date.now());

export const readOptions = (read) => ({
  hint: keyOf(read.bucket, read.plan.line),
  maxTimeMS: timeLeft(read),
});

export const findOptions = (read) => ({
  ...readOptions(read),
  sort: { [read.bucket.time.field]: -1, _id: -1 },
});

export const refuseTimedOut = (error) => {
  throw error.code === MAX_TIME_MS_EXPIRED ? refuse("TIMED_OUT") : error;
};

const readEdge = async (read) => {
  const [edge = null] = await collectionOf(read)
    .find(
      pickedBy(read, (each) => [
        boundPart(each),
        filledPart(each, []),
        refPart(each),
        rangePart(each),
        olderThanCursor(each),
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
      pickedBy(read, (each) => [
        ...matchParts(each),
        ...keysetParts(each),
        residualPart(each),
        ...withinEdge(each, edge),
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
  const edge = isBounded(read) ? (read.edge ?? (await readEdge(read))) : null;
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
    .countDocuments(
      pickedBy(read, (each) => [...matchParts(each), residualPart(each)]),
      { ...readOptions(read), limit: cap + 1 },
    )
    .catch(refuseTimedOut);

  return { count: Math.min(found, cap), capped: found > cap };
};

const leadLine = (bucket, fact) =>
  bucket.indexes.find((line) => line[0] === fact);

export const readStoredValues = async (bucket, fact, maxTimeMS, collection) => {
  const groups = await collection
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
    ? readStoredValues(bucket, fact, maxTimeMS, collectionOf({ bucket }))
    : bucket.facts[fact].values.map(({ value }) => value);

const planOf = ({ bucket, query }) =>
  choosePlan(bucket, query.asked, query.ref !== null, widthsOf(bucket, query));

const askingFor = (read, where) => {
  const query = { ...read.query, where, asked: Object.keys(where) };

  return { ...read, query, plan: planOf({ ...read, query }) };
};

const without = (where, fact) =>
  Object.fromEntries(Object.entries(where).filter(([name]) => name !== fact));

const countValue = (read, fact) => async (value) => ({
  value,
  ...(await readCount({
    ...askingFor(read, { ...read.query.where, [fact]: value }),
    plan: read.plan,
  })),
});

const countValues = async (read, fact) => {
  const values = await valuesOf(read.bucket, fact, timeLeft(read));

  return values && Promise.all(values.map(countValue(read, fact)));
};

// One plan for every value: the others asked, and the group's fact.
const readGroupValues = (read, fact) => {
  const { query } = askingFor(read, without(read.query.where, fact));
  const plan = planOf({
    ...read,
    query: { ...query, asked: [...query.asked, fact] },
  });

  return plan.kind === EXACT ? countValues({ ...read, plan }, fact) : null;
};

// The list with the group's own filter left out: what the All tile counts.
const readGroupTotal = (read, fact) => {
  const total = askingFor(read, without(read.query.where, fact));

  return total.plan.kind === EXACT ? readCount(total) : null;
};

// The whole list counted once, every filter and any ref applied: not on a plan
// that would have to scan to count.
const readTotal = (read) =>
  read.query.count && read.plan.kind === EXACT && !read.tailOnly
    ? readCount(read)
    : null;

const readGroup = (read) => async (fact) => {
  const [values, total] = await Promise.all([
    readGroupValues(read, fact),
    readGroupTotal(read, fact),
  ]);

  return { by: fact, values, total };
};

const describePlan = (read) => ({
  kind: read.plan.kind,
  index: Object.keys(keyOf(read.bucket, read.plan.line)),
  bound: [...boundFacts(read), ...(leadsOnRefs(read.plan) ? ["ref"] : [])],
  filled: read.plan.filled,
  residual: read.plan.residual,
  scans: [read, unkeyedRead(read)]
    .filter(Boolean)
    .reduce(
      (scans, each) =>
        scans +
        scansOf(
          each.bucket,
          each.plan.line,
          each.query.asked,
          widthsOf(each.bucket, each.query),
        ),
      0,
    ),
});

const logBounded = ({ bucket, query, plan }) => {
  if (plan.kind === BOUNDED) {
    logger.info(
      `Bucket ${bucket.id} bounded read: asked [${query.asked.join(", ")}], lead [${[plan.line].flat().join(", ")}]`,
    );
  }
};

const fitsBudget = async (read) => (await readEdge(read)) === null;

const isLaterCount = ({ query }) => query.count && query.cursor !== null;

const wholeRefFits = (read) =>
  isLaterCount(read) &&
  fitsBudget({ ...read, query: { ...read.query, cursor: null } });

const settleTail = async (read, exact) => {
  const edge = await readEdge(read);

  return edge ? { ...read, edge } : { ...exact, tailOnly: isLaterCount(read) };
};

// One reference's rows are few, so its other filters are tested row by row:
// exact while they fit in the scan budget, bounded past it. A later page proves
// only the rows after its cursor fit, so its total needs the whole reference to.
const settleRef = async (read) => {
  const { plan } = read;

  if (!leadsOnRefs(plan) || plan.kind === EXACT) {
    return read;
  }

  const exact = { ...read, plan: { ...plan, kind: EXACT } };

  return (await wholeRefFits(read)) ? exact : settleTail(read, exact);
};

export const runQuery = async (
  bucket,
  query,
  deadline = Date.now() + readTimeoutMs(),
) => {
  const read = await settleRef({
    bucket,
    query,
    plan: query.plan,
    deadline,
  });

  logBounded(read);

  const [{ rows, page }, groups, total] = await Promise.all([
    readPage(read),
    Promise.all(query.groupBy.map(readGroup(read))),
    readTotal(read),
  ]);

  return {
    bucket: bucket.id,
    plan: describePlan(read),
    rows,
    page,
    groups,
    // Only when asked, so a GAS that doesn't count yet reads the answer.
    ...(query.count && { total }),
  };
};
