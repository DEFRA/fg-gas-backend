import { SECONDARY } from "../buckets/engine.js";
import { compileWhere } from "./evaluate.js";
import { promotedOf } from "./evaluate-read.js";
import {
  projectionOf,
  readPathsOf,
  readersFor,
  sizedProjectionOf,
  usedReaders,
} from "./fields.js";
import { FULL_READ } from "./plan.js";
import { compareRows } from "./merge.js";
import { eachStep, timeLeftOf } from "./meter.js";
import { testsOf } from "./query-schema.js";
import { readCollection } from "./read-only.js";
import { refuseQuery } from "./refusal.js";
import { grouper, rowMaker, unwinder } from "./rows.js";
import {
  FULL_CAP,
  UNPROMOTED,
  chargeTo,
  checkGroups,
  costOf,
  eachUnwound,
  emptyBox,
  isUnwinding,
  readFailed,
  shapeCost,
  shaped,
  unwoundRows,
} from "./run-box.js";

// ── Small sources, read in full ──

const attachedRoots = (source) => (source.attach ?? []).map(({ as }) => as);

const isAttached = (roots) => (path) =>
  roots.some((root) => path === root || path.startsWith(`${root}.`));

const localPaths = (source, paths) => {
  const roots = attachedRoots(source);
  const needed = (source.attach ?? []).filter(({ as }) =>
    paths.some(isAttached([as])),
  );

  return [
    ...paths.filter((path) => !isAttached(roots)(path)),
    ...needed.flatMap(({ on }) => on.map(([local]) => local)),
  ];
};

// A path naming the attached record itself reads the whole of it.
const attachProjection = ({ as, on }, paths) =>
  paths.includes(as)
    ? undefined
    : projectionOf([
        ...on.map(([, foreign]) => foreign),
        ...paths
          .filter(isAttached([as]))
          .map((path) => path.slice(as.length + 1))
          .filter(Boolean),
      ]);

export const valueAt = (doc, path) =>
  path.split(".").reduce((value, name) => value?.[name], doc);

// Records are joined on their values as numbers, whatever their BSON type.
export const joinKey = (doc, keys) =>
  JSON.stringify(keys.map((key) => promotedOf(valueAt(doc, key) ?? null)));

const isKey = (value) =>
  value === null || typeof value === "string" || typeof value === "number";

const keyValueAt = (doc, path) => promotedOf(valueAt(doc, path) ?? null);

// Joined on one path holding text or numbers, only the records the local
// ones name are read; otherwise every one.
const attachedFilter = (attach, docs) => {
  if (docs === null || attach.on.length !== 1) {
    return {};
  }

  const [[local, foreign]] = attach.on;
  const keys = [...new Set(docs.map((doc) => keyValueAt(doc, local)))];

  return keys.every(isKey) ? { [foreign]: { $in: keys } } : {};
};

// Each attached record read is charged as a record, and too many are refused
// in the attached records' own name.
const readAttached = async (attach, paths, meter, only) => {
  const docs = await readCollection(attach.collection)
    .find(attachedFilter(attach, only), {
      projection: attachProjection(attach, paths),
      maxTimeMS: Math.max(1, timeLeftOf(meter)),
      readPreference: SECONDARY,
      limit: FULL_CAP + 1,
      ...UNPROMOTED,
    })
    .toArray()
    .catch(readFailed);

  if (docs.length > FULL_CAP) {
    throw refuseQuery("TOO_BIG", { why: null, path: null, noun: attach.noun });
  }

  await eachStep(docs, meter, 1, () => {});

  const foreignKeys = attach.on.map(([, foreign]) => foreign);

  return new Map(docs.map((doc) => [joinKey(doc, foreignKeys), doc]));
};

// `only`: the local records are already filtered, so only those they name
// are read.
const withAttached = async (source, docs, paths, meter, only = null) => {
  const needed = (source.attach ?? []).filter(({ as }) =>
    paths.some(isAttached([as])),
  );
  const maps = await Promise.all(
    needed.map((attach) => readAttached(attach, paths, meter, only && docs)),
  );

  return docs.map((doc) =>
    needed.reduce(
      (joined, attach, n) => ({
        ...joined,
        [attach.as]:
          maps[n].get(
            joinKey(
              doc,
              attach.on.map(([local]) => local),
            ),
          ) ?? null,
      }),
      doc,
    ),
  );
};

const readLocal = async (source, box, paths, meter, sized) => {
  const collection = readCollection(box.collection);
  const maxTimeMS = Math.max(1, timeLeftOf(meter));
  const size = await collection
    .estimatedDocumentCount({ maxTimeMS, readPreference: SECONDARY })
    .catch(readFailed);

  if (size > FULL_CAP) {
    throw refuseQuery("TOO_BIG");
  }

  const docs = await collection
    .find(
      {},
      {
        projection: sizedProjectionOf(localPaths(source, paths), sized),
        maxTimeMS,
        readPreference: SECONDARY,
        allowDiskUse: false,
        limit: FULL_CAP + 1,
        ...UNPROMOTED,
      },
    )
    .toArray()
    .catch(readFailed);

  // It may have grown since it was sized.
  if (docs.length > FULL_CAP) {
    throw refuseQuery("TOO_BIG");
  }

  return docs;
};

const storeOf = ({ bucket, collection, time }) =>
  bucket
    ? { collection: bucket.collection, time: bucket.time.field }
    : { collection, time };

export const fullBox = (source) => {
  const { collection, time } = storeOf(source);

  return {
    id: `${source.service.toLowerCase()}.${source.name}`,
    service: source.service,
    bucket: source.bucket ?? null,
    collection,
    timeNames: time.split("."),
  };
};

const sortedRows = (rows, query) =>
  [...rows].sort(compareRows(query.orderBy)).slice(0, query.limit);

const matching = async (docs, test, box, meter, cost) => {
  const kept = [];

  await eachStep(docs, meter, cost, (doc) => {
    if (test(doc, box)) {
      kept.push(doc);
    }
  });

  return kept;
};

const testsAttached = (source, query) =>
  testsOf(query.where).some(({ path }) =>
    isAttached(attachedRoots(source))(path),
  );

// Records joined to what they attach: before filtering when a test reads
// what is attached, else after, and only for what a count doesn't need.
const readFull = async (source, box, query, meter, readers) => {
  const paths = [
    ...readPathsOf(usedReaders(query, readers)),
    ...source.openPaths,
    box.timeNames.join("."),
  ];
  const test = compileWhere(query.where, readers.readerOf, chargeTo(meter));
  const local = await readLocal(
    source,
    box,
    paths,
    meter,
    Boolean(query.documents),
  );
  const filter = (found) =>
    matching(found, test, box, meter, costOf(query.where));

  if (testsAttached(source, query)) {
    return filter(await withAttached(source, local, paths, meter));
  }

  const docs = await filter(local);

  return query.mode === "count"
    ? docs
    : withAttached(source, docs, paths, meter, true);
};

export const runFull = async (source, query, meter, charge) => {
  const box = fullBox(source);
  const readers = readersFor(source, { charge });
  const docs = await readFull(source, box, query, meter, readers);

  if (query.mode === "count") {
    return {
      read: FULL_READ,
      groups: null,
      boxes: [{ ...emptyBox(box), count: { n: docs.length, capped: false } }],
    };
  }

  const unwound = unwinder({ query, readerOf: readers.readerOf });

  if (query.groupBy) {
    const groups = grouper({ query, readerOf: readers.readerOf });

    await eachStep(
      docs,
      meter,
      shapeCost(query),
      eachUnwound(unwound, query, meter, (one) => {
        groups.add(one, box);
        checkGroups(groups);
      }),
    );

    return {
      read: FULL_READ,
      boxes: [{ ...emptyBox(box), count: { n: docs.length, capped: false } }],
      groups: groups.groups(),
    };
  }

  const make = rowMaker({
    query,
    readerOf: readers.readerOf,
    open: source.open,
    timeNames: box.timeNames,
  });

  if (isUnwinding(query)) {
    const found = unwoundRows(query, make, false);

    await eachStep(
      docs,
      meter,
      1,
      eachUnwound(unwound, query, meter, (one, at) => found.take(one, box, at)),
    );

    return {
      read: FULL_READ,
      groups: null,
      boxes: [{ id: box.id, to: null, end: true, ...found.answer() }],
    };
  }

  return {
    read: FULL_READ,
    groups: null,
    boxes: [
      {
        id: box.id,
        rows: sortedRows(
          await shaped(docs, make, box, meter, shapeCost(query)),
          query,
        ),
        to: null,
        end: true,
        count: { n: docs.length, capped: false },
      },
    ],
  };
};
