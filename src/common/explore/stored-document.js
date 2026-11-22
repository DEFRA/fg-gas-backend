import { copyOf, elementsOf } from "./bson-bytes.js";
import { readCollection } from "./read-only.js";

// Records read as stored, for a page that shows one whole: each as mongod's
// own bytes, cut out of the reply, never decoded or encoded again.

export const RAW_CAP_BYTES = 1024 * 1024;

const SIZE = "s";
const DOCUMENT = "d";

const storedSize = { $bsonSize: "$$ROOT" };

const unsetIn = (input, field) => ({
  $unsetField: { field: { $literal: field }, input },
});

const setIn = (input, [field, value]) => ({
  $setField: { field: { $literal: field }, input, value },
});

// The record less `unset` and with `set`, in one $project, so its size is
// measured as stored, before either.
const documentOf = ({ set = {}, unset = [] }) =>
  Object.entries(set).reduce(
    (input, entry) => setIn(input, entry),
    unset.reduce((input, field) => unsetIn(input, field), "$$ROOT"),
  );

const pipelineOf = ({ match, set, unset, maxBytes, limit }) => [
  { $match: match },
  ...(limit === undefined ? [] : [{ $limit: limit }]),
  {
    $project: {
      _id: 0,
      [SIZE]: storedSize,
      [DOCUMENT]: {
        $cond: [
          { $lte: [storedSize, maxBytes] },
          documentOf({ set, unset }),
          "$$REMOVE",
        ],
      },
    },
  },
];

const resultOf = (buf) => {
  const parts = new Map(
    elementsOf(buf).map((element) => [element.name, element]),
  );
  const document = parts.get(DOCUMENT);

  return {
    storedBytes: buf.readInt32LE(parts.get(SIZE).start),
    document: document ? copyOf(buf, document) : null,
  };
};

// Each record `match` finds, as [{ storedBytes, document }]: its stored size,
// and its bytes less `unset` and with `set` ({ field: expression }), or null
// when it is stored in more than `maxBytes`.
export const readStoredDocuments = async (
  collectionName,
  { match, set, unset, maxBytes, limit, maxTimeMS, readPreference },
) => {
  const found = await readCollection(collectionName)
    .aggregate(pipelineOf({ match, set, unset, maxBytes, limit }), {
      raw: true,
      maxTimeMS,
      readPreference,
    })
    .toArray();

  return found.map(resultOf);
};
