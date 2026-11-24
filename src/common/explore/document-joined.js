import { BSON } from "mongodb";
import { elementsOf, valueKeyOf } from "./bson-bytes.js";
import {
  TEST,
  UNPARSED,
  checkReserve,
  chunksOf,
  closing,
  costOf,
  joinedOptions,
} from "./document-read.js";
import { pathsOfQuery, projectionOf, readPathsOf } from "./fields.js";
import { step } from "./meter.js";
import { testsOf } from "./query-schema.js";
import { readCollection } from "./read-only.js";
import { refusalOf } from "./refusal.js";
import { readFailed } from "./run-box.js";
import { joinKey, valueAt } from "./run-full.js";

// ── What a fetch needs beside the document ──

const isUnder = (as) => (path) => path === as || path.startsWith(`${as}.`);

// The records a small source attaches that the query names a path in.
export const joinsOf = (source, query) => {
  const paths = pathsOfQuery(query);

  return (source.attach ?? []).filter(({ as }) => paths.some(isUnder(as)));
};

export const isOwnPath = (joins) => (path) =>
  !joins.some(({ as }) => isUnder(as)(path));

// The paths the query's filter reads, so a fetched record is tested again
// as found: never a document's bytes, only a projection of its own, beside.
export const testPathsOf = (query, readers) =>
  readPathsOf(testsOf(query.where).map(readers.readerOf));

export const testProjectionOf = (paths) =>
  Object.fromEntries(
    Object.keys(projectionOf(paths)).map((path) => [`${TEST}.${path}`, 1]),
  );

// ── Joined records ──

const foreignOf = (attach) => attach.on.map(([, foreign]) => foreign);
export const localOf = (attach) => attach.on.map(([local]) => local);

const strip = (as) => (path) => path.slice(as.length + 1);

const cutAtDollar = (paths) =>
  [
    ...new Set(
      paths.map((path) =>
        path
          .split(".")
          .filter((name) => !name.startsWith("$"))
          .join("."),
      ),
    ),
  ].filter(Boolean);

// What a joined record is shown as: whole, or the paths the query names in
// it, as mongod projects them; and what its own filter tests read.
export const joinedShapeOf = (attach, query, readers) => {
  const named = pathsOfQuery(query).filter(isUnder(attach.as));
  const own = cutAtDollar(
    named.filter((path) => path !== attach.as).map(strip(attach.as)),
  );
  const tests = testPathsOf(query, readers)
    .filter(isUnder(attach.as))
    .map(strip(attach.as))
    .filter(Boolean);
  const whole = named.includes(attach.as) || own.length === 0;

  return {
    projection: whole ? undefined : projectionOf(["_id", ...own]),
    tests: projectionOf(["_id", ...tests, ...foreignOf(attach)]),
  };
};

const idKeyOfRaw = (buf) =>
  valueKeyOf(
    buf,
    elementsOf(buf).find(({ name }) => name === "_id"),
  );

const rawFind = (attach, filter, projection, { meter, reserve }) =>
  readCollection(attach.collection).find(filter, {
    ...joinedOptions(meter, reserve),
    projection,
  });

// mongod's errors as a read's, the fetch's own refusals as they are.
const joinedFailed = (error) => {
  if (refusalOf(error)) {
    throw error;
  }

  return readFailed(error);
};

// Each joined record's `_id` and what the filter tests in it, by the keys
// its rows join on; read `free` of the work budget in a starts fetch.
export const joinedTestsOf = async (attach, wanted, shape, ctx) => {
  const { meter } = ctx;
  const tests = new Map();

  for (const chunk of chunksOf([...wanted.values()])) {
    checkReserve(meter, ctx.reserve);
    await closing(
      rawFind(attach, { $or: chunk }, shape.tests, ctx),
      async (buf) => {
        await step(meter, costOf(buf.length), ctx.free === true);

        const test = BSON.deserialize(buf, UNPARSED);

        tests.set(joinKey(test, foreignOf(attach)), {
          id: test._id,
          idKey: idKeyOfRaw(buf),
          test,
        });
      },
    ).catch(joinedFailed);
  }

  return tests;
};

// The joined record each held row shows, by the keys it joins on.
export const wantedOf = (attach, found) =>
  new Map(
    [...found.values()]
      .filter(({ test }) => test)
      .map(({ test }) => [
        joinKey(test, localOf(attach)),
        Object.fromEntries(
          attach.on.map(([local, foreign]) => [
            foreign,
            valueAt(test, local) ?? null,
          ]),
        ),
      ]),
  );

const rowsJoinedBy = (attach, found) => {
  const rows = new Map();

  found.forEach(({ test }, n) => {
    const key = test ? joinKey(test, localOf(attach)) : null;

    rows.set(key, [...(rows.get(key) ?? []), n]);
  });

  return rows;
};

// The records a small source attaches, for the rows held only, as stored,
// or as mongod projects the paths the query names in them; each charged to
// every row it is shown beside, and let go with the last of them.
export const fetchJoined = async (attach, ctx) => {
  const { found, holder, meter } = ctx;
  const shape = joinedShapeOf(attach, ctx.query, ctx.readers);
  const tests = await joinedTestsOf(
    attach,
    wantedOf(attach, found),
    shape,
    ctx,
  );
  const byId = new Map([...tests].map(([key, test]) => [test.idKey, key]));
  const rows = rowsJoinedBy(attach, found);
  const joined = new Map();
  const ids = [...tests.values()].map(({ id }) => id);

  for (const chunk of chunksOf(ids)) {
    await closing(
      rawFind(attach, { _id: { $in: chunk } }, shape.projection, ctx),
      async (raw) => {
        await step(meter, costOf(raw.length));

        const key = byId.get(idKeyOfRaw(raw));
        const doc = Buffer.from(raw);

        joined.set(key, { doc, test: tests.get(key).test });
        (rows.get(key) ?? [])
          .filter((n) => found.has(n))
          .forEach((n) =>
            holder.charge(n, doc.length).forEach((gone) => found.delete(gone)),
          );
        joined.forEach((_, held) => {
          if (!(rows.get(held) ?? []).some((n) => found.has(n))) {
            joined.delete(held);
          }
        });
      },
    ).catch(joinedFailed);
  }

  return joined;
};

export const joinedOf = (joins, joined, test) =>
  Object.fromEntries(
    joins.map((attach, n) => [
      attach.as,
      test ? (joined[n].get(joinKey(test, localOf(attach))) ?? null) : null,
    ]),
  );
