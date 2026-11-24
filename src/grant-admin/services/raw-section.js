import Boom from "@hapi/boom";
import { isBsonDocument, valuesOf } from "../../common/explore/bson-bytes.js";
import { ONE_DOCUMENT_ALLOWANCE } from "../../common/explore/query-schema.js";
import { RAW_CAP_BYTES } from "../../common/explore/stored-document.js";

// A Raw tab's stored document, base64 of its own BSON: shown up to 1 MiB
// stored and as many values as one document may print. Bytes that can't be
// read fail the tab alone, never the page.

const unreadable = () => Boom.badData("The stored document can't be read");

const isSize = (value) => Number.isInteger(value) && value >= 0;

const bytesOf = (document) => {
  const buf =
    typeof document === "string" ? Buffer.from(document, "base64") : null;

  if (buf?.toString("base64") !== document) {
    throw unreadable();
  }

  return buf;
};

const tooLarge = (storedBytes) => ({
  content: { document: null, storedBytes },
  tooLarge: true,
});

// The size decides first: a document stored in more than the cap, or past
// the provider's read limit, is too large whatever bytes came with it.
const isOverSize = ({ storedBytes, tooLarge: overReadLimit }) =>
  Boolean(overReadLimit) || storedBytes > RAW_CAP_BYTES;

// Within the cap, a null document can't be read.
const bsonOf = (document) => {
  const buf = document === null ? null : bytesOf(document);

  if (!buf || !isBsonDocument(buf, RAW_CAP_BYTES)) {
    throw unreadable();
  }

  return buf;
};

export const rawSectionOf = (read) => {
  const { document, storedBytes } = read;

  if (!isSize(storedBytes)) {
    throw unreadable();
  }

  if (isOverSize(read)) {
    return tooLarge(storedBytes);
  }

  return valuesOf(bsonOf(document)) <= ONE_DOCUMENT_ALLOWANCE.values
    ? { content: { document, storedBytes }, tooLarge: false }
    : tooLarge(storedBytes);
};
