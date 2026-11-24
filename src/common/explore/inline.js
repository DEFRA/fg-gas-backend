import { CUT, isBsonValue, isOpenObject, typeOf } from "./evaluate-read.js";

// The longest text an object's cell holds: past it, the text ends "…".
export const MAX_INLINE_LENGTH = 2000;

const MORE = "…";
const NAME_PARTS = ["title", "first", "middle", "last"];
const PLAIN_KEY = /^[A-Za-z_]\w*$/;
const HEX = 16;

const isNamePart = ([key, value]) =>
  NAME_PARTS.includes(key) && (value === null || typeof value === "string");

// A person's name, stored as its parts, reads as one name.
const hasNamed = (value) => ["first", "last"].some((part) => value[part]);

const onlyNameParts = (value) =>
  Object.keys(value).every((key) => isNamePart([key, value[key]]));

export const isNameObject = (value) =>
  isOpenObject(value) && hasNamed(value) && onlyNameParts(value);

export const nameOf = (value) =>
  NAME_PARTS.map((part) => value[part])
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

const shownEntries = function* (value) {
  for (const key of Object.keys(value)) {
    if (value[key] !== undefined) {
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

const writeList = (out, list, charge) =>
  writeAll(out, "[]", list, (into, item) => writeValue(into, item, charge));

const writeName = (out, value) => write(out, quoted(nameOf(value)));

const writeField = (value, charge) => (out, key) =>
  key === MORE && value[key] === CUT
    ? writeCut(out)
    : write(out, `${keyText(key)}: `) && writeValue(out, value[key], charge);

const writeObject = (out, value, charge) =>
  writeAll(out, "{}", shownEntries(value), writeField(value, charge));

const writeScalar = (out, value) => write(out, SCALARS[typeOf(value)](value));

// What a value sent typed was cut short of.
const writeCut = (out) => write(out, MORE);

const WRITERS = [
  [(value) => value === CUT, writeCut],
  [Array.isArray, writeList],
  [isNameObject, writeName],
  [isOpenObject, writeObject],
];

const writeValue = (out, value, charge) => {
  charge?.(1);

  const [, writer = writeScalar] =
    WRITERS.find(([holds]) => holds(value)) ?? [];

  return writer(out, value, charge);
};

// A value on one line, much as mongosh prints it: keys unquoted unless they
// need quotes, text always in single quotes, objects and lists inline. Each
// value visited is charged to the reader's `charge`, when it has one.
export const inlineOf = (value, reader = null) => {
  const out = { text: "" };

  return writeValue(out, value, reader?.charge)
    ? out.text
    : `${out.text.slice(0, MAX_INLINE_LENGTH - MORE.length)}${MORE}`;
};

// An object's cell: a name as one name, any other object as its text.
export const objectCellOf = (value, reader = null) =>
  isNameObject(value) ? nameOf(value) : { text: inlineOf(value, reader) };
