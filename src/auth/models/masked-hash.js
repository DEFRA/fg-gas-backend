import { elementsOf, isBsonDocument } from "../../common/explore/bson-bytes.js";

// All a token listing shows of a hash: its first and last three characters.
export const HASH_LENGTH = 64;
export const HASH_EDGE = 3;
const MASK_LENGTH = 6;
export const HASH_MASK = "•".repeat(MASK_LENGTH);
export const MASKED_HASH = new RegExp(
  `^[0-9a-f]{${HASH_EDGE}}${HASH_MASK}[0-9a-f]{${HASH_EDGE}}$`,
);

// What a whole hash looks like inside any string, in either case.
export const HASH_RUN = new RegExp(`[0-9a-f]{${HASH_LENGTH}}`, "i");

export const MAX_ROW_BYTES = 16 * 1024 * 1024;

const DOUBLE = 0x01;
const STRING = 0x02;
const OBJECT_ID = 0x07;
const BOOLEAN = 0x08;
const DATE = 0x09;
const NULL = 0x0a;
const INT32 = 0x10;
const INT64 = 0x12;
const ROW_TYPES = new Set([
  DOUBLE,
  STRING,
  OBJECT_ID,
  BOOLEAN,
  DATE,
  NULL,
  INT32,
  INT64,
]);

const textOf = (buf, { start, end }) =>
  buf.toString("utf8", start + 4, end - 1);

const isPlainElement = (buf, element) =>
  ROW_TYPES.has(element.type) &&
  !HASH_RUN.test(element.name) &&
  (element.type !== STRING || !HASH_RUN.test(textOf(buf, element)));

const isMaskedId = (buf, id) =>
  id?.type === STRING && MASKED_HASH.test(textOf(buf, id));

const isMaskedRow = (buf, elements) => {
  const named = new Map(elements.map((element) => [element.name, element]));

  return (
    named.size === elements.length &&
    named.get("_id")?.type === OBJECT_ID &&
    isMaskedId(buf, named.get("id"))
  );
};

// A token row as stored, read from its bytes, never a decoded copy: a row
// with two elements of one name decodes to one. Flat, of the plain types
// alone, no name repeated, its `_id` an ObjectId and its `id` masked, and no
// name or text holding a whole hash.
export const isMaskedTokenRow = (buf) => {
  if (!isBsonDocument(buf, MAX_ROW_BYTES)) {
    return false;
  }

  const elements = elementsOf(buf);

  return (
    elements.every((element) => isPlainElement(buf, element)) &&
    isMaskedRow(buf, elements)
  );
};
