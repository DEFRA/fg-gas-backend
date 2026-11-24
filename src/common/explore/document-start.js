import { elementBytesAt, isBsonDocument } from "./bson-bytes.js";

// A record's start: the first of its stored bytes, element by element in
// stored order, while a lower bound of what they print stays under
// START_PRINTED code points; the element that crosses it is cut, and those
// after it dropped. Every byte kept is a stored byte, but for the lengths
// and terminators BSON needs around the cut. The record is walked lazily:
// nothing past the cut is read.

// 160 for the line, and room for an escape at the cut and its "…".
export const START_PRINTED = 200;

// The most a start holds: under 200 printed code points of content, and
// the element headers and keys the bound has counted.
export const START_BYTES = 8 * 1024;

// List keys print nothing: a start keeps 4 KiB of them as stored, and each
// after that to its first 8 bytes, so they can't take it past START_BYTES.
const LIST_KEYS_BYTES = 4 * 1024;
const SHORT_LIST_KEY = 8;

const INT32 = 4;
const OBJECT_ID_BYTES = 12;

const STRING = 0x02;
const OBJECT = 0x03;
const LIST = 0x04;
const BINARY = 0x05;
const REGEX = 0x0b;
const POINTER = 0x0c;
const CODE = 0x0d;
const SYMBOL = 0x0e;
const CODE_WITH_SCOPE = 0x0f;

// The old binary subtype holds its own length before what it prints.
const OLD_BINARY = 2;
const OLD_BINARY_LENGTH = 4;

// A Binary of up to 16 bytes may print as a UUID: it is never cut.
const UNCUT_BINARY = 16;

// ── Text as the WHATWG UTF-8 decoder prints it ──

const LOWEST_CONTINUATION = 0x80;
const HIGHEST_CONTINUATION = 0xbf;
const CONTINUATION = [LOWEST_CONTINUATION, HIGHEST_CONTINUATION];

const FIRST_TWO_BYTE_LEAD = 0xc2;
const LAST_TWO_BYTE_LEAD = 0xdf;
const FIRST_THREE_BYTE_LEAD = 0xe0;
const SURROGATE_LEAD = 0xed;
const LAST_THREE_BYTE_LEAD = 0xef;
const FIRST_FOUR_BYTE_LEAD = 0xf0;
const LAST_FOUR_BYTE_LEAD = 0xf4;

const LOWEST_AFTER_FIRST_THREE_BYTE_LEAD = 0xa0;
const HIGHEST_AFTER_SURROGATE_LEAD = 0x9f;
const LOWEST_AFTER_FIRST_FOUR_BYTE_LEAD = 0x90;
const HIGHEST_AFTER_LAST_FOUR_BYTE_LEAD = 0x8f;

const SECOND_BYTES = {
  [FIRST_THREE_BYTE_LEAD]: [
    LOWEST_AFTER_FIRST_THREE_BYTE_LEAD,
    HIGHEST_CONTINUATION,
  ],
  [SURROGATE_LEAD]: [LOWEST_CONTINUATION, HIGHEST_AFTER_SURROGATE_LEAD],
  [FIRST_FOUR_BYTE_LEAD]: [
    LOWEST_AFTER_FIRST_FOUR_BYTE_LEAD,
    HIGHEST_CONTINUATION,
  ],
  [LAST_FOUR_BYTE_LEAD]: [
    LOWEST_CONTINUATION,
    HIGHEST_AFTER_LAST_FOUR_BYTE_LEAD,
  ],
};

// How many continuation bytes follow a lead byte, by its range: one after
// the first, one more after each next.
const LEADS = [
  [FIRST_TWO_BYTE_LEAD, LAST_TWO_BYTE_LEAD],
  [FIRST_THREE_BYTE_LEAD, LAST_THREE_BYTE_LEAD],
  [FIRST_FOUR_BYTE_LEAD, LAST_FOUR_BYTE_LEAD],
];

const isWithin = (byte, [low, high]) => byte >= low && byte <= high;

const continuationsOf = (lead) =>
  LEADS.findIndex((range) => isWithin(lead, range)) + 1;

const rangeAfter = (lead, k) =>
  k === 0 ? (SECOND_BYTES[lead] ?? CONTINUATION) : CONTINUATION;

const isContinued = (buf, next, end, range) =>
  next < end && isWithin(buf[next], range);

// Where the decoder's next output ends: one well-formed sequence, or one
// maximal ill-formed subsequence, which prints as U+FFFD.
const outputEnd = (buf, at, end) => {
  const lead = buf[at];
  const needed = continuationsOf(lead);
  let next = at + 1;

  for (let k = 0; k < needed; k += 1) {
    if (!isContinued(buf, next, end, rangeAfter(lead, k))) {
      return next;
    }

    next += 1;
  }

  return next;
};

// The first `most` outputs of the bytes from `at` to `end`: how many there
// are, up to `most`, and where the last of them ends.
const outputsOf = (buf, at, end, most) => {
  let count = 0;
  let next = at;

  while (next < end && count < most) {
    next = outputEnd(buf, next, end);
    count += 1;
  }

  return { count, end: next };
};

const countOf = (buf, at, end, most) => outputsOf(buf, at, end, most).count;

// ── Where a value's parts are ──

const textAt = (buf, at) => ({
  from: at + INT32,
  to: at + INT32 + buf.readInt32LE(at) - 1,
});

const regexAt = (buf, at) => {
  const patternEnd = buf.indexOf(0, at);

  return {
    pattern: { from: at, to: patternEnd },
    flags: { from: patternEnd + 1, to: buf.indexOf(0, patternEnd + 1) },
  };
};

const binaryAt = (buf, at) => {
  const length = buf.readInt32LE(at);
  const subtype = buf[at + INT32];
  const payload = at + INT32 + 1;
  const skipped =
    subtype === OLD_BINARY && length >= OLD_BINARY_LENGTH
      ? OLD_BINARY_LENGTH
      : 0;

  return { length, subtype, payload, printed: length - skipped, skipped };
};

const codeAt = (buf, at) => {
  const code = at + INT32;

  return { code, scope: code + INT32 + buf.readInt32LE(code) };
};

const lastOf = (buf, at) => at + buf.readInt32LE(at) - 1;

// ── What a value prints at least ──

const QUOTES = 2;
const SEPARATOR = 2;
const BRACES = 2;
const COLON = 2;

const textBound = (buf, { from, to }, most) => countOf(buf, from, to, most);

// Base64: 4 characters for every 3 bytes; a UUID prints longer.
const BASE64_BYTES = 3;
const BASE64_CHARACTERS = 4;

const binaryBound = (bytes) =>
  Math.ceil(bytes / BASE64_BYTES) * BASE64_CHARACTERS;

const documentBound = (buf, at, list, most) => {
  const last = lastOf(buf, at);
  let used = BRACES;

  for (let next = at + INT32, first = true; next < last && used < most;) {
    const element = elementBytesAt(buf, next, last);

    used += elementBound(buf, element, { list, first }, most - used);
    next = element.end;
    first = false;
  }

  return used;
};

const VALUE_BOUNDS = {
  [STRING]: (buf, at, most) => textBound(buf, textAt(buf, at), most) + QUOTES,
  [CODE]: (buf, at, most) => textBound(buf, textAt(buf, at), most) + QUOTES,
  [SYMBOL]: (buf, at, most) => textBound(buf, textAt(buf, at), most) + QUOTES,
  [POINTER]: (buf, at, most) => textBound(buf, textAt(buf, at), most) + QUOTES,
  [REGEX]: (buf, at, most) => {
    const { pattern, flags } = regexAt(buf, at);
    const shown = textBound(buf, pattern, most);

    return shown + textBound(buf, flags, most - shown) + QUOTES;
  },
  [BINARY]: (buf, at) => binaryBound(binaryAt(buf, at).printed),
  [OBJECT]: (buf, at, most) => documentBound(buf, at, false, most),
  [LIST]: (buf, at, most) => documentBound(buf, at, true, most),
  [CODE_WITH_SCOPE]: (buf, at, most) => {
    const { code, scope } = codeAt(buf, at);
    const shown = textBound(buf, textAt(buf, code), most) + QUOTES + COLON;

    return shown + documentBound(buf, scope, false, most - shown);
  },
};

const valueBound = (buf, { type, start }, most) =>
  Object.hasOwn(VALUE_BOUNDS, type)
    ? VALUE_BOUNDS[type](buf, start, Math.max(0, most))
    : 1;

const keyBound = (buf, { nameStart, start }, most) =>
  countOf(buf, nameStart, start - 1, most) + COLON;

// What an element prints at least, counted up to `most`: list keys never
// print.
const elementBound = (buf, element, { list, first }, most) => {
  const separator = first ? 0 : SEPARATOR;
  const key = list ? 0 : keyBound(buf, element, most - separator);

  return separator + key + valueBound(buf, element, most - separator - key);
};

// ── BSON around the cut ──

const int32 = (n) => {
  const buf = Buffer.alloc(INT32);

  buf.writeInt32LE(n);

  return buf;
};

const NUL = Buffer.alloc(1);

const sized = (parts) => {
  const body = Buffer.concat(parts);

  return Buffer.concat([int32(body.length + INT32 + 1), body, NUL]);
};

const stringOf = (bytes) =>
  Buffer.concat([int32(bytes.length + 1), bytes, NUL]);

const EMPTY_DOCUMENT = sized([]);

// The first `most` outputs of text, never splitting one.
const cutText = (buf, { from, to }, most) =>
  buf.subarray(from, outputsOf(buf, from, to, Math.max(0, most)).end);

// ── Cutting a value ──

const cutString = (buf, at, room) =>
  stringOf(cutText(buf, textAt(buf, at), room - QUOTES));

const cutPointer = (buf, at, room) => {
  const text = textAt(buf, at);

  return Buffer.concat([
    stringOf(cutText(buf, text, room - QUOTES)),
    buf.subarray(text.to + 1, text.to + 1 + OBJECT_ID_BYTES),
  ]);
};

const cutRegex = (buf, at, room) => {
  const { pattern, flags } = regexAt(buf, at);
  const left = room - QUOTES;
  const kept = cutText(buf, pattern, left);
  const shown = countOf(buf, pattern.from, pattern.to, left);
  const keptFlags =
    kept.length === pattern.to - pattern.from
      ? cutText(buf, flags, left - shown)
      : Buffer.alloc(0);

  return Buffer.concat([kept, NUL, keptFlags, NUL]);
};

// A Binary of its first `printed` bytes; the old subtype's own length is a
// length too, so says what is kept.
const binaryWith = (buf, binary, printed) => {
  const from = binary.payload + binary.skipped;

  return Buffer.concat([
    int32(binary.skipped + printed),
    Buffer.of(binary.subtype),
    binary.skipped ? int32(printed) : Buffer.alloc(0),
    buf.subarray(from, from + printed),
  ]);
};

const cutBinary = (buf, at, room) => {
  const binary = binaryAt(buf, at);

  if (binary.printed <= UNCUT_BINARY) {
    return buf.subarray(at, binary.payload + binary.length);
  }

  return binaryWith(
    buf,
    binary,
    Math.min(
      binary.printed,
      Math.floor(Math.max(0, room) / BASE64_CHARACTERS) * BASE64_BYTES,
    ),
  );
};

const cutCodeWithScope = (buf, at, room, state) => {
  const { code, scope } = codeAt(buf, at);
  const text = textAt(buf, code);
  const shown = countOf(buf, text.from, text.to, room) + QUOTES + COLON;
  const keptScope =
    shown < room
      ? cutDocument(buf, scope, false, room - shown, state)
      : EMPTY_DOCUMENT;
  const body = Buffer.concat([
    stringOf(cutText(buf, text, room - QUOTES)),
    keptScope,
  ]);

  return Buffer.concat([int32(body.length + INT32), body]);
};

const CUTS = {
  [STRING]: cutString,
  [CODE]: cutString,
  [SYMBOL]: cutString,
  [POINTER]: cutPointer,
  [REGEX]: cutRegex,
  [BINARY]: cutBinary,
  [OBJECT]: (buf, at, room, state) => cutDocument(buf, at, false, room, state),
  [LIST]: (buf, at, room, state) => cutDocument(buf, at, true, room, state),
  [CODE_WITH_SCOPE]: cutCodeWithScope,
};

const cutValue = (buf, element, room, state) =>
  Object.hasOwn(CUTS, element.type)
    ? CUTS[element.type](buf, element.start, room, state)
    : buf.subarray(element.start, element.end);

// A value in its type's smallest form, beside a key cut at the bound.
const EMPTY_TEXT = stringOf(Buffer.alloc(0));

const SMALLEST = {
  [STRING]: () => EMPTY_TEXT,
  [CODE]: () => EMPTY_TEXT,
  [SYMBOL]: () => EMPTY_TEXT,
  [POINTER]: (buf, at) => cutPointer(buf, at, 0),
  [REGEX]: () => Buffer.concat([NUL, NUL]),
  [BINARY]: (buf, at) => binaryWith(buf, binaryAt(buf, at), 0),
  [OBJECT]: () => EMPTY_DOCUMENT,
  [LIST]: () => EMPTY_DOCUMENT,
  [CODE_WITH_SCOPE]: () =>
    Buffer.concat([
      int32(INT32 + EMPTY_TEXT.length + EMPTY_DOCUMENT.length),
      EMPTY_TEXT,
      EMPTY_DOCUMENT,
    ]),
};

const smallestOf = (buf, { type, start, end }) =>
  Object.hasOwn(SMALLEST, type)
    ? SMALLEST[type](buf, start)
    : buf.subarray(start, end);

// ── Keys ──

// The printer writes a key bare when it is a word, else quoted (core/doc.ts
// KEY): each byte as one character, so none past ASCII is a word's.
const KEY = /^[A-Za-z_][\w$]*$/;

const isBare = (bytes) => KEY.test(bytes.toString("latin1"));

const elementOf = (type, key, value) =>
  Buffer.concat([Buffer.of(type), key, NUL, value]);

// A key crossing the bound is cut as text is, at one output at least, its
// value kept in its smallest form. A whole key the printer quotes whose kept
// part it wouldn't is said (`quotedKey`).
const cutAtKey = (buf, element, room, state) => {
  const whole = buf.subarray(element.nameStart, element.start - 1);
  const kept = cutText(
    buf,
    { from: element.nameStart, to: element.start - 1 },
    Math.max(1, room - COLON),
  );

  state.quotedKey = !isBare(whole) && isBare(kept);

  return elementOf(element.type, kept, smallestOf(buf, element));
};

const keyOf = (buf, element) =>
  buf.subarray(element.nameStart, element.start - 1);

// The bytes of the list keys in a value, at every depth.
const listKeysOf = (buf, at, list) => {
  const last = lastOf(buf, at);
  let bytes = 0;

  for (let next = at + INT32; next < last;) {
    const element = elementBytesAt(buf, next, last);

    bytes += (list ? keyOf(buf, element).length : 0) + listKeysIn(buf, element);
    next = element.end;
  }

  return bytes;
};

const listKeysIn = (buf, { type, start }) => {
  if (type === CODE_WITH_SCOPE) {
    return listKeysOf(buf, codeAt(buf, start).scope, false);
  }

  return type === OBJECT || type === LIST
    ? listKeysOf(buf, start, type === LIST)
    : 0;
};

const listKeyOf = (buf, element, state) => {
  const key = keyOf(buf, element);

  if (state.listKeys + key.length <= LIST_KEYS_BYTES) {
    state.listKeys += key.length;

    return key;
  }

  state.rekeyed ||= key.length > SHORT_LIST_KEY;

  return key.subarray(0, SHORT_LIST_KEY);
};

const keptKeyOf = (buf, element, list, state) =>
  list ? listKeyOf(buf, element, state) : keyOf(buf, element);

const cutElement = (buf, element, { list, room }, state) => {
  const key = list ? 0 : keyBound(buf, element, room);

  if (!list && key >= room) {
    return cutAtKey(buf, element, room, state);
  }

  return elementOf(
    element.type,
    keptKeyOf(buf, element, list, state),
    cutValue(buf, element, room - key, state),
  );
};

// An element within the bound is kept as stored while the start holds its
// list keys; else it is made again, those keys kept short, and prints whole.
const keptElement = (buf, element, { list, first, room }, state) => {
  const listKeys =
    (list ? keyOf(buf, element).length : 0) + listKeysIn(buf, element);

  if (state.listKeys + listKeys > LIST_KEYS_BYTES) {
    return cutElement(
      buf,
      element,
      { list, room: room - (first ? 0 : SEPARATOR) },
      state,
    );
  }

  state.listKeys += listKeys;

  return buf.subarray(element.at, element.end);
};

// The element crossing the bound, cut with what is left of it after its
// separator, if anything is.
const crossing = (buf, element, { list, first, room }, state) => {
  const left = room - (first ? 0 : SEPARATOR);

  state.cut = true;

  return left > 0
    ? [cutElement(buf, element, { list, room: left }, state)]
    : [];
};

const cutDocument = (buf, at, list, left, state) => {
  const last = lastOf(buf, at);
  const parts = [];
  let used = BRACES;

  for (let next = at + INT32, first = true; next < last;) {
    const element = elementBytesAt(buf, next, last);
    const room = left - used;
    const cost = elementBound(buf, element, { list, first }, room);

    if (cost >= room) {
      parts.push(...crossing(buf, element, { list, first, room }, state));
      break;
    }

    parts.push(keptElement(buf, element, { list, first, room }, state));
    used += cost;
    next = element.end;
    first = false;
  }

  return sized(parts);
};

class StartError extends Error {}

const isMadeAgain = (state) => state.cut || state.rekeyed;

// The start of the stored document `buf`: { doc, cut }, when nothing was
// cut `doc` the record's own bytes, copied, but for list keys kept short;
// and `quotedKey` when a cut key is quoted only whole.
export const startOf = (buf) => {
  const state = { cut: false, quotedKey: false, rekeyed: false, listKeys: 0 };
  const cut = cutDocument(buf, 0, false, START_PRINTED, state);
  const doc = isMadeAgain(state) ? cut : Buffer.from(buf);

  if (!isBsonDocument(doc, START_BYTES)) {
    throw new StartError("Explore start is malformed");
  }

  return {
    doc,
    cut: state.cut,
    ...(state.quotedKey && { quotedKey: true }),
  };
};
