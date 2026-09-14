import Boom from "@hapi/boom";

export const CURSOR_VERSION = 1;
export const SOURCE_KEYS = ["gasInbox", "gasOutbox", "cwInbox", "cwOutbox"];

const INBOX_SORT_KEY = "eventTime";
const OUTBOX_SORT_KEY = "publicationDate";
const HEX_OBJECT_ID = /^[0-9a-f]{24}$/;

// The sort field name a source's own `paginate` expects inside its cursor:
// inbox sources key on `eventTime`, outbox sources on `publicationDate`.
export const sortKeyFor = (sourceKey) =>
  sourceKey.endsWith("Outbox") ? OUTBOX_SORT_KEY : INBOX_SORT_KEY;

const cannotDecode = () => Boom.badRequest("Cannot decode cursor");

const toBase64Url = (data) =>
  Buffer.from(JSON.stringify(data)).toString("base64url");

// `Buffer.from` never throws on garbage, so `JSON.parse` is the real guard.
const parseJsonCursor = (value) => {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString());
  } catch {
    throw cannotDecode();
  }
};

const isPlainObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isSortValue = (value) => typeof value === "string" || value === null;

const isValidSlice = (sourceKey, parsed) =>
  isPlainObject(parsed) &&
  isSortValue(parsed[sortKeyFor(sourceKey)]) &&
  typeof parsed._id === "string" &&
  HEX_OBJECT_ID.test(parsed._id);

const assertSlice = (sourceKey, slice) => {
  if (!isValidSlice(sourceKey, parseJsonCursor(slice))) {
    throw cannotDecode();
  }
};

const readSlice = (sourceKey, value) => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    throw cannotDecode();
  }

  assertSlice(sourceKey, value);

  return value;
};

const emptySlices = () =>
  Object.fromEntries(SOURCE_KEYS.map((key) => [key, null]));

// `cursorValue` is the *verbatim* stored sort-key value, never a re-canonicalised
// one - canonicalising it would move the keyset boundary and silently skip rows.
export const encodeSourceCursor = (sourceKey, { cursorValue, id }) =>
  toBase64Url({ [sortKeyFor(sourceKey)]: cursorValue ?? null, _id: id });

export const encodeCompositeCursor = (slices) =>
  toBase64Url({
    v: CURSOR_VERSION,
    ...Object.fromEntries(SOURCE_KEYS.map((key) => [key, slices[key] ?? null])),
  });

// Validates eagerly and completely, before any source is queried: a tampered
// slice must be a 400 here rather than a swallowed rejection inside a fan-out.
export const decodeCompositeCursor = (cursor) => {
  if (!cursor) {
    return emptySlices();
  }

  const parsed = parseJsonCursor(cursor);

  if (!isPlainObject(parsed) || parsed.v !== CURSOR_VERSION) {
    throw cannotDecode();
  }

  return Object.fromEntries(
    SOURCE_KEYS.map((key) => [key, readSlice(key, parsed[key])]),
  );
};
