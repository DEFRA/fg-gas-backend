import { createDeclarationCache } from "./declarations.js";

const sources = new Map();

// What a service tells the search about its records:
// - collection: the search table; records: the records' own collection
// - lead: the fact a declaration belongs to, on the record and the search document
// - projection: the record fields `viewOf` reads, besides _id, the lead and createdAt
// - viewOf(record): the object a declared path is evaluated against
// - listDeclarations(): [{ value, search, change }], each lead value with its
//   current definition's `search` block, or null, and its count of config
//   changes
export const defineSearchSource = ({
  collection,
  records,
  lead,
  projection,
  viewOf,
  listDeclarations,
  ttlMs,
}) => ({
  collection,
  records,
  lead,
  projection,
  viewOf,
  declarations: createDeclarationCache(listDeclarations, ttlMs),
});

export const registerSearchSource = (source) => {
  if (sources.has(source.collection)) {
    throw new Error(`Search "${source.collection}" is already registered`);
  }

  sources.set(source.collection, source);
};

export const findSearchSource = (collection) => {
  const source = sources.get(collection);

  if (!source) {
    throw new Error(`Search "${collection}" is not registered`);
  }

  return source;
};

export const clearSearchSources = () => sources.clear();
