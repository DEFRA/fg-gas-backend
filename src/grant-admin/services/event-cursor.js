import Boom from "@hapi/boom";
import { isObjectIdHex } from "../../common/object-id-hex.js";

export const CURSOR_VERSION = 1;
export const SOURCE_KEYS = ["gasInbox", "gasOutbox", "cwInbox", "cwOutbox"];

// Every source, Caseworking included, keys its cursor slice by this field.
export const CURSOR_SORT_FIELD = "publicationDate";

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

const isValidSlice = (parsed) =>
  isPlainObject(parsed) &&
  isSortValue(parsed[CURSOR_SORT_FIELD]) &&
  isObjectIdHex(parsed._id);

const assertSlice = (slice) => {
  if (!isValidSlice(parseJsonCursor(slice))) {
    throw cannotDecode();
  }
};

const readSlice = (value) => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    throw cannotDecode();
  }

  assertSlice(value);

  return value;
};

const emptySlices = () =>
  Object.fromEntries(SOURCE_KEYS.map((key) => [key, null]));

// Verbatim: re-canonicalising the value would move the keyset boundary and skip rows.
export const encodeSourceCursor = ({ cursorValue, id }) =>
  toBase64Url({ [CURSOR_SORT_FIELD]: cursorValue ?? null, _id: id });

export const encodeCompositeCursor = (slices) =>
  toBase64Url({
    v: CURSOR_VERSION,
    ...Object.fromEntries(SOURCE_KEYS.map((key) => [key, slices[key] ?? null])),
  });

// Eager, so a tampered slice is a 400 rather than a rejection inside the fan-out.
export const decodeCompositeCursor = (cursor) => {
  if (!cursor) {
    return emptySlices();
  }

  const parsed = parseJsonCursor(cursor);

  if (!isPlainObject(parsed) || parsed.v !== CURSOR_VERSION) {
    throw cannotDecode();
  }

  return Object.fromEntries(
    SOURCE_KEYS.map((key) => [key, readSlice(parsed[key])]),
  );
};
