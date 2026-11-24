import { db } from "../mongo-client.js";

// Explore only ever reads: it is handed a collection only as this view, which
// has none of the collection's writes and refuses a pipeline that writes.
export const READS = Object.freeze([
  "find",
  "aggregate",
  "countDocuments",
  "distinct",
  "estimatedDocumentCount",
]);

export const WRITE_STAGES = Object.freeze(["$out", "$merge"]);

// The options Explore gives each read. Any other is refused: aggregate's
// `out`, for one, writes as a write stage does.
export const READ_OPTIONS = Object.freeze({
  find: Object.freeze([
    "projection",
    "sort",
    "skip",
    "limit",
    "hint",
    "maxTimeMS",
    "readPreference",
    "allowDiskUse",
    "batchSize",
    "raw",
    "promoteValues",
    "bsonRegExp",
    "validation",
  ]),
  aggregate: Object.freeze([
    "hint",
    "maxTimeMS",
    "readPreference",
    "allowDiskUse",
    "batchSize",
    "raw",
  ]),
  countDocuments: Object.freeze([
    "hint",
    "maxTimeMS",
    "readPreference",
    "limit",
  ]),
  distinct: Object.freeze([]),
  estimatedDocumentCount: Object.freeze(["maxTimeMS", "readPreference"]),
});

const isPlain = (value) =>
  typeof value === "object" &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value ?? 0));

const namedIn = (value) =>
  Object.keys(value).find((key) => WRITE_STAGES.includes(key));

const innerOf = (value) => {
  if (Array.isArray(value)) {
    return value;
  }

  return isPlain(value) ? Object.values(value) : [];
};

// A write stage named anywhere in a pipeline, sub-pipelines included.
export const writeStageIn = (value) =>
  (isPlain(value) && namedIn(value)) ||
  innerOf(value).map(writeStageIn).find(Boolean) ||
  null;

// A pipeline's own arrays and objects, so what was checked is what is sent.
const copyOf = (value) => {
  if (Array.isArray(value)) {
    return value.map(copyOf);
  }

  return isPlain(value)
    ? Object.fromEntries(
        Object.entries(value).map(([key, inner]) => [key, copyOf(inner)]),
      )
    : value;
};

const notARead = (stage) =>
  new Error(`Explore only reads: ${stage} is not a read`);

const optionsOf = (read, options = {}) => {
  const other = Object.keys(options).find(
    (key) => !READ_OPTIONS[read].includes(key),
  );

  if (other) {
    throw new Error(`Explore only reads: ${read} takes no ${other} option`);
  }

  return { ...options };
};

// A cursor's reads alone: an aggregation cursor can add stages, and either
// holds its client.
const readCursor = (cursor) =>
  Object.freeze({
    toArray: () => cursor.toArray(),
    close: () => cursor.close(),
    [Symbol.asyncIterator]: () => cursor[Symbol.asyncIterator](),
  });

const aggregateOf = (collection) => (pipeline, options) => {
  const sent = copyOf(pipeline);
  const stage = writeStageIn(sent);

  if (stage) {
    throw notARead(stage);
  }

  return readCursor(
    collection.aggregate(sent, optionsOf("aggregate", options)),
  );
};

export const readOnly = (collection) =>
  Object.freeze({
    find: (filter, options) =>
      readCursor(collection.find(filter, optionsOf("find", options))),
    aggregate: aggregateOf(collection),
    countDocuments: (filter, options) =>
      collection.countDocuments(filter, optionsOf("countDocuments", options)),
    distinct: (key, filter, options) =>
      collection.distinct(key, filter, optionsOf("distinct", options)),
    estimatedDocumentCount: (options) =>
      collection.estimatedDocumentCount(
        optionsOf("estimatedDocumentCount", options),
      ),
  });

export const readCollection = (name) => readOnly(db.collection(name));
