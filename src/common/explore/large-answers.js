import { setImmediate } from "node:timers/promises";
import { elementsOf, isBsonDocument } from "./bson-bytes.js";
import { START_BYTES } from "./document-start.js";
import { isDecimalTag } from "./evaluate-read.js";
import {
  DOCUMENTS_MODE,
  MAX_DOCUMENT_BYTES,
  MAX_LIMIT,
  MAX_UNWINDS,
  STARTS,
  idText,
  partSchema,
} from "./query-schema.js";

// Deeper than mongod nests a document, so no stored value is deeper.
const MAX_NESTING = 200;

// Rows are checked by hand, a few hundred between turns of the event loop:
// Joi takes too long over thousands of them at once.
const CHUNK = 500;

const isPlain = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isScalar = (value) =>
  typeof value === "string" ||
  (typeof value === "number" && Number.isFinite(value));

// A list inside a list, whole, the outermost at 0.
const isListCell = (value, depth) =>
  Array.isArray(value) &&
  depth < MAX_NESTING &&
  value.every((item) => isCell(item, depth + 1));

// An object, as the text that shows it.
const isObjectCell = (value) =>
  isPlain(value) &&
  Object.keys(value).length === 1 &&
  typeof value.text === "string";

const isValueCell = (value) =>
  value === null || isScalar(value) || isObjectCell(value);

const isCell = (value, depth = 0) =>
  isValueCell(value) || isListCell(value, depth);

// A value of another BSON type, as the BSON of { v }: that one element.
const isOneValue = (buf) => {
  if (!isBsonDocument(buf, MAX_DOCUMENT_BYTES)) {
    return false;
  }

  const elements = elementsOf(buf);

  return elements.length === 1 && elements[0].name === "v";
};

const ORDERED_TAGS = {
  x: (text) => isDecimalTag(text),
  n: (text) => ["NaN", "Infinity", "-Infinity"].includes(text),
  b: (value) => typeof value === "boolean",
  d: (text) => isText(text) && !Number.isNaN(Date.parse(text)),
  o: (hex) => isText(hex) && /^[0-9a-f]{24}$/i.test(hex),
  i: (value) => Number.isInteger(value),
  f: (value) =>
    (typeof value === "number" && Number.isFinite(value)) ||
    ["NaN", "Infinity", "-Infinity", "-0"].includes(value),
  l: (text) => isText(text) && /^-?\d{1,19}$/.test(text),
  e: (base64) => isText(base64) && isOneValue(Buffer.from(base64, "base64")),
  k: (entries, depth) =>
    Array.isArray(entries) &&
    entries.every(
      (entry) =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        isText(entry[0]) &&
        isOrdered(entry[1], depth + 1),
    ),
};

const isTagged = (value, depth) => {
  const tags = Object.keys(value);

  return (
    tags.length === 1 &&
    Object.hasOwn(ORDERED_TAGS, tags[0]) &&
    ORDERED_TAGS[tags[0]](value[tags[0]], depth)
  );
};

const isNested = (value, depth) =>
  Array.isArray(value)
    ? value.every((item) => isOrdered(item, depth + 1))
    : isPlain(value) && isTagged(value, depth);

// A value sent typed (evaluate.js orderedOf), whole. A sum's parts carry
// its type and its Decimal128s' sum as text.
const isLeaf = (value) => value === null || isScalar(value);

const isOrdered = (value, depth = 0) =>
  isLeaf(value) || (depth < MAX_NESTING * 2 && isNested(value, depth));

export const hasCells = (cells) =>
  isPlain(cells) && Object.values(cells).every((cell) => isCell(cell));

const invalid = (path, type) =>
  Object.assign(new Error("Explore answer cannot be read"), {
    details: [{ path, type }],
  });

const isList = (items) => Array.isArray(items) && items.length <= MAX_LIMIT * 4;

const pause = (at) =>
  at % CHUNK === CHUNK - 1 ? setImmediate() : Promise.resolve();

// Each item checked by `holds`, with a turn for others every few hundred.
export const checkEach = async (items, holds, path) => {
  if (!isList(items)) {
    throw invalid(path, "array");
  }

  for (let at = 0; at < items.length; at += 1) {
    if (!holds(items[at], at)) {
      throw invalid([...path, at], "item");
    }

    await pause(at);
  }
};

const isText = (value) => typeof value === "string";

const isKey = (key) =>
  isPlain(key) && isOptional(isText)(key.t) && isText(key.i);

const isOptional = (holds) => (value) => value === null || holds(value);

const isPosition = (value) =>
  value === null || (Number.isInteger(value) && value >= 0);

const isAbsentOr = (holds) => (value) => value === undefined || holds(value);

const isIdText = (value) => isText(value) && !idText.validate(value).error;

const isPositions = (value) =>
  Array.isArray(value) &&
  value.length <= MAX_UNWINDS &&
  value.every(isPosition);

const isSize = (value) =>
  value === null ||
  (Number.isInteger(value) && value >= 0 && value <= MAX_DOCUMENT_BYTES);

// A row also carries, with documents, its record's typed `_id`, unwind
// positions and size.
const isRowOf = (row) =>
  [
    isKey(row.key),
    isOptional(isPlain)(row.open),
    hasCells(row.cells),
    isOrdered(row.order),
    isAbsentOr(isIdText)(row.id),
    isAbsentOr(isPositions)(row.at),
    isAbsentOr(isSize)(row.size),
  ].every(Boolean);

const isPartRow = (row) => isPlain(row) && isRowOf(row);

const hasPartials = (aggs) =>
  isPlain(aggs) && Object.values(aggs).every((value) => isOrdered(value));

const isGroupOf = (group) =>
  [
    isOptional(isScalar)(group.key),
    isOrdered(group.value),
    Number.isInteger(group.n),
    hasPartials(group.aggs),
  ].every(Boolean);

const isGroup = (group) => isPlain(group) && isGroupOf(group);

const shellOf = (part) => ({
  ...part,
  boxes: Array.isArray(part.boxes)
    ? part.boxes.map((box) => ({ ...box, rows: [] }))
    : part.boxes,
  groups: Array.isArray(part.groups) ? [] : part.groups,
});

const checkRows = (part) =>
  Promise.all(
    part.boxes.map((box, n) =>
      checkEach(box.rows, isPartRow, ["boxes", n, "rows"]),
    ),
  );

// ── A `documents` fetch's answer ──

const BASE64_BYTES = 3;
const BASE64_CHARACTERS = 4;

const isBase64Bson = (text, most) =>
  isText(text) &&
  text.length <= Math.ceil(most / BASE64_BYTES) * BASE64_CHARACTERS &&
  isBsonDocument(Buffer.from(text, "base64"), most);

// Where an event was read is beside the records a context joins.
const ADDED = new Set(["service", "box"]);

// A context's service and box are text; each record it joins is null or a
// record as stored, valid BSON.
const isContextEntry = ([name, value]) =>
  ADDED.has(name)
    ? isText(value)
    : value === null || isBase64Bson(value, MAX_DOCUMENT_BYTES);

const isContext = (context) =>
  context === null ||
  (isPlain(context) && Object.entries(context).every(isContextEntry));

const NOTES = {
  gone: (value) => value === true,
  unread: (value) => value === true,
  tooLarge: (value) => value === true,
};

const isNoted = (entry) => {
  const notes = Object.keys(NOTES).filter((note) => Object.hasOwn(entry, note));

  return notes.length === 1 && NOTES[notes[0]](entry[notes[0]]);
};

const hasNoNote = (entry) =>
  Object.keys(NOTES).every((note) => !Object.hasOwn(entry, note));

const isFetched = (entry) =>
  isBase64Bson(entry.doc, MAX_DOCUMENT_BYTES) &&
  hasNoNote(entry) &&
  isAbsentOr((changed) => changed === true)(entry.changed);

const isSentOrNoted = (entry) =>
  entry.doc === undefined ? isNoted(entry) : isFetched(entry);

const isSamePositions = (at, asked) =>
  isPositions(at) &&
  at.length === asked.length &&
  at.every((n, m) => n === asked[m]);

// An entry for the row asked in its place: its box, `_id` and positions.
const isFetchedOf = (entry, asked) =>
  [
    entry.box === asked.box,
    isIdText(entry.id) && entry.id === asked.id,
    isSamePositions(entry.at, asked.at),
    isContext(entry.context ?? null),
    isSentOrNoted(entry),
  ].every(Boolean);

const isFetchedEntry = (asked) => (entry, n) =>
  isPlain(entry) && n < asked.length && isFetchedOf(entry, asked[n]);

const base64Bytes = (text) => Buffer.byteLength(text, "base64");

const contextBytes = (context) =>
  Object.entries(context ?? {})
    .filter(([name, value]) => !ADDED.has(name) && isText(value))
    .reduce((sum, [, text]) => sum + base64Bytes(text), 0);

// The bytes a documents answer sends: its documents and the records joined
// beside them, or its starts; entries without either sending none.
const entryBytes = ({ doc, start, context }) => {
  if (isText(doc)) {
    return base64Bytes(doc) + contextBytes(context);
  }

  return isPlain(start) && isText(start.doc) ? base64Bytes(start.doc) : 0;
};

export const sentBytes = (entries) =>
  entries.reduce((sum, entry) => sum + entryBytes(entry), 0);

// A `documents` fetch's answer, checked by hand: one entry for each row
// asked, in its order, each document and joined record valid BSON of at
// most 16 MiB, the first asked held, and at most `bytes` of documents and
// joined records in all, or one row's alone.
const failUnless = (holds, path, rule) => {
  if (!holds) {
    throw invalid(path, rule);
  }
};

const isWithinBytes = (sent, bytes) =>
  sent.length <= 1 || sentBytes(sent) <= bytes;

// ── A starts fetch's answer ──

const START_KEYS = new Set(["doc", "cut", "quotedKey"]);

const isStartOfKeys = (start) =>
  [
    Object.keys(start).every((key) => START_KEYS.has(key)),
    isBase64Bson(start.doc, START_BYTES),
    typeof start.cut === "boolean",
    isAbsentOr((quoted) => quoted === true)(start.quotedKey),
  ].every(Boolean);

const isStart = (start) => isPlain(start) && isStartOfKeys(start);

const isCount = (most) => (value) =>
  Number.isInteger(value) && value >= 0 && value <= most;

const isPrinted = (printed) =>
  isPlain(printed) &&
  Object.keys(printed).length === 2 &&
  isCount(MAX_DOCUMENT_BYTES)(printed.bytes) &&
  isCount(MAX_DOCUMENT_BYTES)(printed.values);

const ENTRY_KEYS = new Set(["box", "id", "at"]);
const STARTED_KEYS = new Set([...ENTRY_KEYS, "start", "printed", "changed"]);
const START_NOTES = {
  gone: (value) => value === true,
  tooLarge: (value) => value === true,
};

const hasOnly = (entry, keys) =>
  Object.keys(entry).every((key) => keys.has(key));

const isStarted = (entry) =>
  hasOnly(entry, STARTED_KEYS) &&
  isStart(entry.start) &&
  isPrinted(entry.printed) &&
  isAbsentOr((changed) => changed === true)(entry.changed);

const isStartNoted = (entry) => {
  const notes = Object.keys(entry).filter((key) => !ENTRY_KEYS.has(key));

  return (
    notes.length === 1 &&
    Object.hasOwn(START_NOTES, notes[0]) &&
    START_NOTES[notes[0]](entry[notes[0]])
  );
};

const isStartOf = (entry, asked) =>
  [
    entry.box === asked.box,
    isIdText(entry.id) && entry.id === asked.id,
    isSamePositions(entry.at, asked.at),
    entry.start === undefined ? isStartNoted(entry) : isStarted(entry),
  ].every(Boolean);

const isStartEntry = (asked) => (entry, n) =>
  isPlain(entry) && n < asked.length && isStartOf(entry, asked[n]);

const ENDED = new Set(["time", "work"]);

// A starts fetch's answer, checked by hand: an entry for each row asked, in
// its order, up to where the fetch ended (none at all, if it read none),
// each a start of valid BSON within START_BYTES and what its document
// printed whole, or a note that it is gone or too large to make; and, when
// it ended before the last, why: out of time or of work.
const checkStarts = async (answer, { asked }) => {
  failUnless(isPlain(answer) && isList(answer.documents), [], "object");
  failUnless(answer.documents.length <= asked.length, ["documents"], "length");
  failUnless(
    answer.documents.length < asked.length
      ? ENDED.has(answer.ended)
      : answer.ended === undefined,
    ["ended"],
    "ended",
  );

  await checkEach(answer.documents, isStartEntry(asked), ["documents"]);

  return answer;
};

export const checkDocuments = async (answer, { bytes, asked }) => {
  failUnless(isPlain(answer) && isList(answer.documents), [], "object");
  failUnless(answer.documents.length === asked.length, ["documents"], "length");

  await checkEach(answer.documents, isFetchedEntry(asked), ["documents"]);

  // The first row asked is always held.
  failUnless(answer.documents[0]?.unread !== true, ["documents", 0], "unread");

  failUnless(
    isWithinBytes(
      answer.documents.filter(({ doc }) => doc),
      bytes,
    ),
    ["documents"],
    "bytes",
  );

  return answer;
};

// One service's part, checked as `partSchema` says, its rows and groups by
// hand. Throws as Joi does, naming the path and the rule. The answer to a
// `documents` fetch, by what was asked, is checked as checkDocuments says.
const isFetchQuery = (query) => query?.mode === DOCUMENTS_MODE;

// What a `documents` fetch asked for: its rows, within its bytes.
const fetchOf = (query) => ({
  bytes: query.documents.bytes,
  asked: query.rows,
});

const checkFetched = (part, query) =>
  query.documents.mode === STARTS
    ? checkStarts(part, fetchOf(query))
    : checkDocuments(part, fetchOf(query));

export const checkPart = (part, { query, ...options } = {}) =>
  isFetchQuery(query)
    ? checkFetched(part, query)
    : checkRowsPart(part, options);

const checkRowsPart = async (part, options) => {
  const { error, value } = partSchema.validate(shellOf(part), options);

  if (error) {
    throw error;
  }

  await checkRows(part);

  if (Array.isArray(part.groups)) {
    await checkEach(part.groups, isGroup, ["groups"]);
  }

  return {
    ...value,
    boxes: value.boxes.map((box, n) => ({ ...box, rows: part.boxes[n].rows })),
    groups: part.groups,
  };
};
