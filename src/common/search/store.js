import { isDeepStrictEqual } from "node:util";
import { logger } from "../logger.js";
import { db } from "../mongo-client.js";
import { PREFIX } from "./declaration.js";
import { isBuiltLater } from "./declarations.js";
import { TIME, searchDocumentOf } from "./document.js";
import { describeLeftOut } from "./keys.js";

// The record fields a search document is built from.
export const searchProjectionOf = ({ lead, projection }) => ({
  [lead]: 1,
  [TIME]: 1,
  ...projection,
});

export const warnLeftOut = (source, left, records = 1) => {
  if (Object.keys(left).length > 0) {
    logger.warn(
      `Search ${source.collection}: values not indexed on ${records} records: ${describeLeftOut(left)}`,
    );
  }
};

// Unlike `$lte`, also true of a document with no stamp.
const notLaterThan = (stamp) => ({ stamp: { $not: { $gt: stamp } } });

const replaceWrite = (document) => ({
  replaceOne: {
    filter: { _id: document._id },
    replacement: document,
    upsert: true,
  },
});

// Left for the reindexer, which rebuilds any document whose `sig` is not the
// current one.
const OUT_OF_DATE = null;

const declarationFor = async (source, value, stored) => {
  const cached = await source.declarations.forValue(value);

  return isBuiltLater(stored, cached)
    ? source.declarations.forValue(value, { fresh: true })
    : cached;
};

const markOutOfDate = async (source, filter, session) => {
  const { matchedCount } = await db
    .collection(source.collection)
    .updateOne(filter, { $set: { sig: OUT_OF_DATE } }, { session });

  if (matchedCount === 0) {
    logger.warn(
      `Search ${source.collection}: document ${filter._id} changed while written, left to the sweep`,
    );
  }
};

const replaceUnlessLater = async (
  source,
  record,
  declaration,
  { stored, session },
) => {
  const { document, left } = searchDocumentOf(source, record, declaration);

  warnLeftOut(source, left);

  const { matchedCount } = await db
    .collection(source.collection)
    .replaceOne(
      { _id: document._id, ...(stored && notLaterThan(declaration.stamp)) },
      document,
      { upsert: !stored, session },
    );

  if (stored && matchedCount === 0) {
    await markOutOfDate(source, { _id: record._id }, session);
  }
};

// Written after the record, in its session when the caller has one. A
// document built from a later declaration than this instance holds, even
// read afresh, is not replaced but marked out of date, so the reindexer of an
// instance holding that declaration rebuilds it from the record. So is one
// rebuilt from a later declaration between the read and the replace, which
// may hold the record as it was before this write.
export const indexRecord = async (source, record, session) => {
  const searches = db.collection(source.collection);
  const stored = await searches.findOne(
    { _id: record._id },
    { projection: { _id: 0, stamp: 1 }, session },
  );
  const declaration = await declarationFor(source, record[source.lead], stored);

  if (isBuiltLater(stored, declaration)) {
    await markOutOfDate(
      source,
      { _id: record._id, stamp: stored.stamp },
      session,
    );

    return;
  }

  await replaceUnlessLater(source, record, declaration, { stored, session });
};

const escapeRegex = (text) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

const keyText = ({ key, value }) => `${key}:${value}`;

const keysPart = (field) =>
  field.match === PREFIX
    ? { $regex: `^${escapeRegex(keyText(field))}` }
    : keyText(field);

const afterPart = (after) =>
  after
    ? [
        { [TIME]: { $lte: after.t } },
        { $nor: [{ [TIME]: after.t, _id: { $gte: after.i } }] },
      ]
    : [];

const rangePart = (range) =>
  Object.keys(range).length > 0 ? [{ [TIME]: range }] : [];

const matchParts = (lead, { value, field, range = {} }) => [
  { [lead]: value, keys: keysPart(field) },
  ...rangePart(range),
];

// Newest first. `range` holds `$gte`/`$lte` on the stored time, and `after`
// the position the previous page ended on.
export const readSearchPage = (
  { collection, lead },
  { after = null, limit, maxTimeMS, ...match },
) =>
  db
    .collection(collection)
    .find(
      { $and: [...matchParts(lead, match), ...afterPart(after)] },
      {
        projection: { _id: 1, [TIME]: 1 },
        sort: { [TIME]: -1, _id: -1 },
        limit,
        maxTimeMS,
      },
    )
    .toArray();

// What `readSearchPage` matches with no `after`, counted up to `limit`.
export const countSearchMatches = (
  { collection, lead },
  { limit, maxTimeMS, ...match },
) =>
  db
    .collection(collection)
    .countDocuments({ $and: matchParts(lead, match) }, { limit, maxTimeMS });

// Documents of `value` built from another declaration, none of them from a
// later one.
export const findStaleIds = async (
  { collection, lead },
  value,
  { sig, stamp },
  limit,
) => {
  const docs = await db
    .collection(collection)
    .find(
      { [lead]: value, sig: { $ne: sig }, ...notLaterThan(stamp) },
      { projection: { _id: 1 }, limit, readPreference: "primary" },
    )
    .toArray();

  return docs.map(({ _id }) => _id);
};

// A search document whose record is gone is removed with it, and one built
// meanwhile from a later declaration is left as it is.
export const rebuildSearchDocuments = async (
  source,
  ids,
  declaration,
  session,
) => {
  const records = await db
    .collection(source.records)
    .find(
      { _id: { $in: ids } },
      { projection: searchProjectionOf(source), session },
    )
    .toArray();
  const built = records.map((record) =>
    searchDocumentOf(source, record, declaration),
  );
  const found = new Set(records.map(({ _id }) => String(_id)));
  const gone = ids.filter((id) => !found.has(String(id)));
  const unlessLater = notLaterThan(declaration.stamp);

  const { matchedCount, deletedCount } = await db
    .collection(source.collection)
    .bulkWrite(
      [
        ...built.map(({ document }) => ({
          replaceOne: {
            filter: { _id: document._id, ...unlessLater },
            replacement: document,
          },
        })),
        ...gone.map((id) => ({ deleteOne: { filter: { _id: id } } })),
      ],
      { session, ordered: false },
    );

  return { built, rebuilt: matchedCount, removed: deletedCount };
};

const isSameDocument = (lead, built, stored) =>
  stored !== undefined &&
  isDeepStrictEqual(
    [built[lead], built[TIME], built.keys, built.sig],
    [stored[lead], stored[TIME], stored.keys, stored.sig],
  );

const idRange = (after, last) => {
  const range = {
    ...(after === null ? {} : { $gt: after }),
    ...(last === null ? {} : { $lte: last }),
  };

  return Object.keys(range).length > 0 ? { _id: range } : {};
};

// Checks up to `limit` records after `after`, in `_id` order, against their
// search documents: a missing or different one is replaced, and one in that
// range whose record is gone is removed. A record whose lead value has no
// current declaration listed, and a document built from a later declaration,
// are left alone. `last` is null once the records end, so the range then runs
// to the end of the search documents.
export const sweepRecords = async (
  source,
  declarations,
  { after, limit },
  session,
) => {
  const records = await db
    .collection(source.records)
    .find(idRange(after, null), {
      projection: searchProjectionOf(source),
      sort: { _id: 1 },
      limit,
      session,
    })
    .toArray();
  const last = records.length === limit ? records.at(-1)._id : null;
  const stored = await db
    .collection(source.collection)
    .find(idRange(after, last), { session })
    .toArray();
  const storedById = new Map(stored.map((doc) => [String(doc._id), doc]));
  const changed = records
    .filter((record) => {
      const declaration = declarations.get(record[source.lead]);

      return (
        declaration !== undefined &&
        !isBuiltLater(storedById.get(String(record._id)), declaration)
      );
    })
    .map((record) =>
      searchDocumentOf(source, record, declarations.get(record[source.lead])),
    )
    .filter(
      ({ document }) =>
        !isSameDocument(
          source.lead,
          document,
          storedById.get(String(document._id)),
        ),
    );
  const found = new Set(records.map(({ _id }) => String(_id)));
  const gone = stored.filter(({ _id }) => !found.has(String(_id)));
  const writes = [
    ...changed.map(({ document }) => replaceWrite(document)),
    ...gone.map(({ _id }) => ({ deleteOne: { filter: { _id } } })),
  ];

  if (writes.length > 0) {
    await db
      .collection(source.collection)
      .bulkWrite(writes, { session, ordered: false });
  }

  return { checked: records.length, changed, removed: gone.length, last };
};
