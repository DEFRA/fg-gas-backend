// BSON read as bytes, element by element, never decoded into values: so a
// document is checked and cut out of a reply exactly as mongod sent it.

const INT32 = 4;
const DOCUMENT = 0x03;
const ARRAY = 0x04;
const EMBEDDED = new Set([DOCUMENT, ARRAY]);

// Deeper than mongod nests a document, so a document past it is no BSON
// mongod made.
const MAX_NESTING = 200;

class BsonError extends Error {}

const fail = () => {
  throw new BsonError("Not a BSON document");
};

const int32At = (buf, at, end) => {
  if (at + INT32 > end) {
    fail();
  }

  return buf.readInt32LE(at);
};

const cstringEnd = (buf, at, end) => {
  const nul = buf.indexOf(0, at);

  if (nul === -1 || nul >= end) {
    fail();
  }

  return nul + 1;
};

const OBJECT_ID_BYTES = 12;

// A string: its length, its bytes and a closing nul. Its UTF-8 is left as
// stored: the page says where it isn't valid.
const stringEnd = (buf, at, end) => {
  const length = int32At(buf, at, end);
  const after = at + INT32 + length;

  if (length < 1 || after > end || buf[after - 1] !== 0) {
    fail();
  }

  return after;
};

const sizedEnd = (buf, at, end) => {
  const length = int32At(buf, at, end);

  if (length < INT32 + 1 || at + length > end) {
    fail();
  }

  return at + length;
};

const binaryEnd = (buf, at, end) => {
  const length = int32At(buf, at, end);
  const after = at + INT32 + 1 + length;

  if (length < 0 || after > end) {
    fail();
  }

  return after;
};

const regexEnd = (buf, at, end) =>
  cstringEnd(buf, cstringEnd(buf, at, end), end);

// Code with scope: its whole length, then its code and its scope document,
// which end where it does.
const CODE_WITH_SCOPE = 0x0f;
const MIN_CODE_WITH_SCOPE = 14;

const scopeAt = (buf, at, end) => stringEnd(buf, at + INT32, end);

const codeWithScopeEnd = (buf, at, end) => {
  const after = sizedEnd(buf, at, end);

  failUnless(buf.readInt32LE(at) >= MIN_CODE_WITH_SCOPE);
  failUnless(documentEnd(buf, scopeAt(buf, at, after)) === after);

  return after;
};

const BOOLEAN = 0x08;

// Each type's value, from where it starts to where it ends: a fixed size,
// or found from its bytes.
const VALUE_ENDS = {
  0x01: 8,
  0x02: stringEnd,
  [DOCUMENT]: sizedEnd,
  [ARRAY]: sizedEnd,
  0x05: binaryEnd,
  0x06: 0,
  0x07: OBJECT_ID_BYTES,
  [BOOLEAN]: 1,
  0x09: 8,
  0x0a: 0,
  0x0b: regexEnd,
  0x0c: (buf, at, end) => stringEnd(buf, at, end) + OBJECT_ID_BYTES,
  0x0d: stringEnd,
  0x0e: stringEnd,
  [CODE_WITH_SCOPE]: codeWithScopeEnd,
  0x10: 4,
  0x11: 8,
  0x12: 8,
  0x13: 16,
  0xff: 0,
  0x7f: 0,
};

const failUnless = (holds) => {
  if (!holds) {
    fail();
  }
};

// Where the document at `at` ends, its length and closing nul checked.
const documentEnd = (buf, at) => {
  const length = int32At(buf, at, buf.length);
  const end = at + length;

  failUnless(length >= INT32 + 1 && end <= buf.length && buf[end - 1] === 0);

  return end;
};

const valueEndOf = (buf, type, at, end) => {
  failUnless(Object.hasOwn(VALUE_ENDS, type));

  const ends = VALUE_ENDS[type];
  const valueEnd = typeof ends === "number" ? at + ends : ends(buf, at, end);

  failUnless(valueEnd <= end);

  return valueEnd;
};

// The element at `at`, its name left as bytes: where it, its name and its
// value start, and where it ends. `last` is its document's closing nul.
export const elementBytesAt = (buf, at, last) => {
  const type = buf[at];
  const nameEnd = cstringEnd(buf, at + 1, last);

  return {
    type,
    at,
    nameStart: at + 1,
    start: nameEnd,
    end: valueEndOf(buf, type, nameEnd, last),
  };
};

const elementAt = (buf, at, end) => {
  const {
    type,
    nameStart,
    start,
    end: valueEnd,
  } = elementBytesAt(buf, at, end);

  return {
    type,
    name: buf.toString("utf8", nameStart, start - 1),
    start,
    end: valueEnd,
  };
};

// The elements of the document at `at`, as { type, name, start, end }:
// where each value's bytes start and end.
export const elementsOf = (buf, at = 0) => {
  const last = documentEnd(buf, at) - 1;
  const elements = [];

  for (let next = at + INT32; next < last; next = elements.at(-1).end) {
    elements.push(elementAt(buf, next, last));
  }

  return elements;
};

const isValidValue = ({ type, start }, buf) =>
  type !== BOOLEAN || buf[start] <= 1;

// Where an element's own document starts, if it holds one: an embedded
// document, a list, or code's scope.
const innerAt = (buf, { type, start, end }) => {
  if (EMBEDDED.has(type)) {
    return start;
  }

  return type === CODE_WITH_SCOPE ? scopeAt(buf, start, end) : null;
};

const checkWithin = (buf, at, depth) => {
  failUnless(depth <= MAX_NESTING);

  for (const element of elementsOf(buf, at)) {
    failUnless(isValidValue(element, buf));

    const inner = innerAt(buf, element);

    if (inner !== null) {
      checkWithin(buf, inner, depth + 1);
    }
  }
};

const isSized = (buf, most) =>
  Buffer.isBuffer(buf) && buf.length <= most && buf.length >= INT32 + 1;

const isWellFormed = (buf) => {
  try {
    checkWithin(buf, 0, 0);

    return buf.readInt32LE(0) === buf.length;
  } catch (error) {
    if (error instanceof BsonError) {
      return false;
    }

    throw error;
  }
};

// Whether `buf` is one whole BSON document of at most `most` bytes, every
// element of every embedded document and list well formed.
export const isBsonDocument = (buf, most) =>
  isSized(buf, most) && isWellFormed(buf);

// An element's value as its own bytes, copied: a raw reply is one buffer,
// which a slice of it would hold on to.
export const copyOf = (buf, { start, end }) =>
  Buffer.from(buf.subarray(start, end));

// One element's type and value bytes, as text: two values with the same
// key are the same BSON value.
export const valueKeyOf = (buf, { type, start, end }) =>
  `${type}:${buf.toString("hex", start, end)}`;

// How many values a document prints: its elements at every depth, each
// embedded document, list and code's scope one beside what it holds.
// Names are never decoded, so a large record is counted quickly.
export const valuesOf = (buf, at = 0) => {
  const last = documentEnd(buf, at) - 1;
  let n = 0;

  for (let next = at + INT32; next < last;) {
    const element = elementBytesAt(buf, next, last);
    const inner = innerAt(buf, element);

    n += 1 + (inner === null ? 0 : valuesOf(buf, inner));
    next = element.end;
  }

  return n;
};

// Whether `text` is a record's `_id` as base64 BSON of { _id }: one whole
// document of that one element.
export const isIdText = (text, most) => {
  const buf = Buffer.from(text, "base64");

  if (!isBsonDocument(buf, most)) {
    return false;
  }

  const elements = elementsOf(buf);

  return elements.length === 1 && elements[0].name === "_id";
};
