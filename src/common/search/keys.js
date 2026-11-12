import { normalise } from "./normalise.js";
import { parsePath, valuesAt } from "./path.js";

export const MAX_VALUES_PER_FIELD = 50;
export const MAX_VALUE_LENGTH = 200;

const isAbsent = (value) => value === null || value === undefined;

const isText = (value) =>
  typeof value === "string" ||
  (typeof value === "number" && Number.isFinite(value));

const valueAt = (view, path) => valuesAt(view, parsePath(path))[0];

// The parts of a name are one value, joined in order; a part that is not text
// spoils the whole.
const joinedAt = (view, paths) => {
  const parts = paths
    .map((path) => valueAt(view, path))
    .filter((v) => !isAbsent(v));

  if (parts.length === 0) {
    return [];
  }

  return parts.every(isText)
    ? [parts.join(" ")]
    : parts.filter((v) => !isText(v));
};

const valuesOf = (view, path) =>
  Array.isArray(path) ? joinedAt(view, path) : valuesAt(view, parsePath(path));

const NOT_TEXT = Symbol("not text");

const normalisedOf = (value) => (isText(value) ? normalise(value) : NOT_TEXT);

const fits = (normalised, kept) =>
  normalised.length <= MAX_VALUE_LENGTH && kept.size < MAX_VALUES_PER_FIELD;

const tallyText = (normalised, kept, left) => {
  if (normalised === "" || kept.has(normalised)) {
    return;
  }

  if (fits(normalised, kept)) {
    kept.add(normalised);
  } else {
    left.overCap += 1;
  }
};

const tally = (normalised, kept, left) => {
  if (normalised === NOT_TEXT) {
    left.unsupported += 1;
  } else {
    tallyText(normalised, kept, left);
  }
};

const fieldKeys = (view, { key, path }) => {
  const kept = new Set();
  const left = { unsupported: 0, overCap: 0 };

  for (const value of valuesOf(view, path)) {
    if (!isAbsent(value)) {
      tally(normalisedOf(value), kept, left);
    }
  }

  return { keys: [...kept].map((value) => `${key}:${value}`), left };
};

const isLeft = ({ unsupported, overCap }) => unsupported + overCap > 0;

// `left` counts, by field key, the values found but not indexed: values that
// are not strings or numbers, and those beyond the caps.
export const keysOf = (view, fields) =>
  fields.reduce(
    (built, field) => {
      const { keys, left } = fieldKeys(view, field);

      return {
        keys: [...built.keys, ...keys],
        left: isLeft(left) ? { ...built.left, [field.key]: left } : built.left,
      };
    },
    { keys: [], left: {} },
  );

const NONE = { unsupported: 0, overCap: 0 };

const plus = (counts, more) => ({
  unsupported: counts.unsupported + more.unsupported,
  overCap: counts.overCap + more.overCap,
});

export const addLeftOut = (total, left) =>
  Object.entries(left).reduce(
    (sum, [key, counts]) => ({ ...sum, [key]: plus(sum[key] ?? NONE, counts) }),
    total,
  );

// Counts and keys only, never a value.
export const describeLeftOut = (left) =>
  Object.entries(left)
    .map(
      ([key, { unsupported, overCap }]) =>
        `${key} (${unsupported} not text, ${overCap} over the caps)`,
    )
    .join(", ");
