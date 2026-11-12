import { valueDigest } from "./digest.js";

// The searched "kind:normalised value", as the lookup holds it.
const searchedOf = ({ ref, field }) =>
  field ? `${field.key}:${field.value}` : ref;

// Only with a key: without one a digest of a short value could be guessed.
const digestPart = (query, key) => {
  const searched = searchedOf(query);

  return key && searched ? { valueDigest: valueDigest(key, searched) } : {};
};

const NO_FIELD = { key: null, match: null };

const fieldOf = ({ field }) => {
  const { key, match } = field ?? NO_FIELD;

  return { field: key, match };
};

// What a query audit holds of the search: the field and its match, and the
// value searched for only as a digest keyed with `key`.
export const searchAuditOf = (query, key) => ({
  ...fieldOf(query),
  ...digestPart(query, key),
});
