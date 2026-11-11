import { keysOf } from "./keys.js";

export const TIME = "createdAt";

export const searchKeyOf = (lead) => ({
  [lead]: 1,
  keys: 1,
  [TIME]: -1,
  _id: -1,
});

export const staleKeyOf = (lead) => ({ [lead]: 1, sig: 1, stamp: 1 });

export const ensureSearchIndexes = async (database, { collection, lead }) => {
  for (const key of [searchKeyOf(lead), staleKeyOf(lead)]) {
    await database.collection(collection).createIndex(key);
  }
};

// The search document holds nothing of the record but its lead, its time as
// stored, and the normalised declared values, with which declaration built them.
export const searchDocumentOf = (source, record, declaration) => {
  const { keys, left } = keysOf(source.viewOf(record), declaration.fields);

  return {
    document: {
      _id: record._id,
      [source.lead]: record[source.lead],
      [TIME]: record[TIME],
      keys,
      sig: declaration.sig,
      stamp: declaration.stamp,
    },
    left,
  };
};
