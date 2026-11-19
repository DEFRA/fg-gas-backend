import { CUT, isBsonValue, isOpenObject, typeOf } from "./evaluate-read.js";
import { isDeniedName } from "./paths.js";

// The longest text an object's cell holds: past it, the text ends "…".
export const MAX_INLINE_LENGTH = 2000;

const MORE = "…";
const NAME_PARTS = ["title", "first", "middle", "last"];
const PLAIN_KEY = /^[A-Za-z_]\w*$/;
const HEX = 16;

const isNamePart = ([key, value]) =>
  NAME_PARTS.includes(key) && (value === null || typeof value === "string");

const everyPath = () => true;

// What of a value may be read, from its path: every path unless a reader's
// `readable` says otherwise, each value visited charged to it.
const lensOf = ({ path = "", readable = everyPath, charge } = {}) => ({
  path,
  readable,
  charge,
});

const below = (lens, key) => ({
  ...lens,
  path: lens.path ? `${lens.path}.${key}` : key,
});

const mayRead = (lens, key) =>
  !isDeniedName(key) && lens.readable(below(lens, key).path);

// A person's name, stored as its parts, reads as one name: judged on the
// parts the lens may read, so a hidden field never changes how it reads.
const hasNamed = (value, lens) =>
  ["first", "last"].some((part) => value[part] && mayRead(lens, part));

// Stops at the first readable field that is no part of a name.
const onlyNameParts = (value, lens) => {
  for (const key of Object.keys(value)) {
    if (mayRead(lens, key) && !isNamePart([key, value[key]])) {
      return false;
    }
  }

  return true;
};

export const isNameObject = (value, lens = lensOf()) =>
  isOpenObject(value) && hasNamed(value, lens) && onlyNameParts(value, lens);

export const nameOf = (value, lens = lensOf()) =>
  NAME_PARTS.filter((part) => mayRead(lens, part))
    .map((part) => value[part])
    .filter(Boolean)
    .join(" ");

const NAMED_ESCAPES = {
  "\\": "\\\\",
  "'": "\\'",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
  "\b": "\\b",
  "\f": "\\f",
  "\v": "\\v",
};

const DELETE = 0x7f;

const isControl = (ch) => ch < " " || ch.charCodeAt(0) === DELETE;

const escapeOf = (ch) => {
  if (Object.hasOwn(NAMED_ESCAPES, ch)) {
    return NAMED_ESCAPES[ch];
  }

  return isControl(ch)
    ? `\\x${ch.charCodeAt(0).toString(HEX).padStart(2, "0")}`
    : ch;
};

// Text past the cap can't be shown, so it is never escaped.
const quoted = (text) =>
  `'${Array.from(text.slice(0, MAX_INLINE_LENGTH), escapeOf).join("")}'`;

const keyText = (key) => (PLAIN_KEY.test(key) ? key : quoted(key));

const BSON_TEXT = {
  Binary: (value) =>
    `Binary.createFromBase64('${value.toString("base64")}', ${value.sub_type})`,
  Timestamp: (value) => `Timestamp({ t: ${value.t}, i: ${value.i} })`,
};

const bsonText = (value) =>
  BSON_TEXT[value._bsontype]?.(value) ??
  `${value._bsontype}('${String(value)}')`;

const SCALARS = {
  null: () => "null",
  number: String,
  string: quoted,
  boolean: String,
  date: (date) =>
    Number.isNaN(date.getTime())
      ? "Invalid Date"
      : `ISODate('${date.toISOString()}')`,
  objectId: (id) => `ObjectId('${String(id)}')`,
  object: (value) => (isBsonValue(value) ? bsonText(value) : "{}"),
};

const write = (out, text) => {
  out.text += text;

  return out.text.length <= MAX_INLINE_LENGTH;
};

const writeItem = (out, item, n, writeOne) =>
  (n === 0 || write(out, ", ")) && writeOne(out, item);

// Items are written until the text is full: what is past it is never
// visited. How many were written, or -1 once the text is full.
const writeItems = (out, items, writeOne) => {
  let written = 0;

  for (const item of items) {
    if (!writeItem(out, item, written, writeOne)) {
      return -1;
    }

    written += 1;
  }

  return written;
};

const shownEntries = function* (value, lens) {
  for (const key of Object.keys(value)) {
    if (value[key] !== undefined && mayRead(lens, key)) {
      yield key;
    }
  }
};

const closing = (out, written, close) =>
  written === 0 ? write(out, close) : written > 0 && write(out, ` ${close}`);

const writeAll = (out, [open, close], items, writeOne) => {
  const at = out.text.length;

  if (!write(out, `${open} `)) {
    return false;
  }

  const written = writeItems(out, items, writeOne);

  if (written === 0) {
    out.text = out.text.slice(0, at + open.length);
  }

  return closing(out, written, close);
};

const writeList = (out, list, lens) =>
  writeAll(out, "[]", list, (into, item) => writeValue(into, item, lens));

const writeName = (out, value, lens) => write(out, quoted(nameOf(value, lens)));

const writeField = (value, lens) => (out, key) =>
  key === MORE && value[key] === CUT
    ? writeCut(out)
    : write(out, `${keyText(key)}: `) &&
      writeValue(out, value[key], below(lens, key));

const writeObject = (out, value, lens) =>
  writeAll(out, "{}", shownEntries(value, lens), writeField(value, lens));

const writeScalar = (out, value) => write(out, SCALARS[typeOf(value)](value));

// What a value sent typed was cut short of.
const writeCut = (out) => write(out, MORE);

const WRITERS = [
  [(value) => value === CUT, writeCut],
  [Array.isArray, writeList],
  [isNameObject, writeName],
  [isOpenObject, writeObject],
];

const writeValue = (out, value, lens) => {
  lens.charge?.(1);

  const [, writer = writeScalar] =
    WRITERS.find(([holds]) => holds(value, lens)) ?? [];

  return writer(out, value, lens);
};

// A value on one line, much as mongosh prints it: keys unquoted unless they
// need quotes, text always in single quotes, objects and lists inline. Only
// what the reader may read is written, and denied names never.
export const inlineOf = (value, reader = null) => {
  const out = { text: "" };

  return writeValue(out, value, lensOf(reader ?? undefined))
    ? out.text
    : `${out.text.slice(0, MAX_INLINE_LENGTH - MORE.length)}${MORE}`;
};

// An object's cell: a name as one name, any other object as its text.
export const objectCellOf = (value, reader = null) => {
  const lens = lensOf(reader ?? undefined);

  return isNameObject(value, lens)
    ? nameOf(value, lens)
    : { text: inlineOf(value, reader) };
};
