import { CASE_CLASSES } from "./case-classes.js";

export const MAX_PATTERN_LENGTH = 64;
export const MAX_STATES = 2000;
export const MAX_REPEAT = 20;

// Why a pattern is refused, as the checker words it.
export const PATTERN_MESSAGES = {
  length: `Keep the pattern to at most ${MAX_PATTERN_LENGTH} characters`,
  flags: "Patterns take the flags i, m, s and u, each once",
  states: "This pattern is too complex: write a simpler one",
  repeat: `Repeat a part at most ${MAX_REPEAT} times: {1,${MAX_REPEAT}}`,
  unsupported: (what) => `This pattern uses ${what}, which isn’t supported`,
  invalid: "This pattern isn’t valid",
};

const fail = (message) => {
  throw Object.assign(new Error(message), { pattern: true });
};

export const failUnless = (holds, message) => {
  if (!holds) {
    fail(message);
  }
};

// ── Characters, as JavaScript's RegExp reads them ──

const LINE_SEPARATOR = 0x2028;
const PARAGRAPH_SEPARATOR = 0x2029;
export const LINE_ENDS = new Set(
  ["\n", "\r"].concat(
    [LINE_SEPARATOR, PARAGRAPH_SEPARATOR].map((code) =>
      String.fromCharCode(code),
    ),
  ),
);

// JavaScript's WhiteSpace and LineTerminator, which \s means.
const SPACES = new Set([
  ..."\t\n\v\f\r \u00A0\u1680\u2028\u2029\u202F\u205F\u3000\uFEFF",
]);
const EN_QUAD = 0x2000;
const HAIR_SPACE = 0x200a;

const DIGIT = /[0-9]/;
const WORD = /[A-Za-z0-9_]/;
const HEX = /^[0-9a-fA-F]+$/;
export const ASCII = /^[ -~\t\n\r]*$/;

const isSpace = (ch) => {
  const code = ch.codePointAt(0);

  return SPACES.has(ch) || (code >= EN_QUAD && code <= HAIR_SPACE);
};

const isDigit = (ch) => DIGIT.test(ch);
const isWord = (ch) => WORD.test(ch);

const CLASS_ESCAPES = {
  d: isDigit,
  D: (ch) => !isDigit(ch),
  w: isWord,
  W: (ch) => !isWord(ch),
  s: isSpace,
  S: (ch) => !isSpace(ch),
};

// ── Case, as RegExp's i reads it ──

const single = (text) => [...text].length === 1;
export const codeOf = (ch) => ch.codePointAt(0);

const classesOf = (list) =>
  new Map(
    list.flatMap((text) => {
      const members = [...text];

      return members.map((ch) => [codeOf(ch), members]);
    }),
  );

const ODD_CLASSES = {
  i: classesOf(CASE_CLASSES.i),
  iu: classesOf(CASE_CLASSES.iu),
};

const plainClass = (ch) => [
  ...new Set([ch, ch.toLowerCase(), ch.toUpperCase()].filter(single)),
];

// The characters i makes one with `ch`, itself included.
const membersOf = (unicode) => {
  const odd = ODD_CLASSES[unicode ? "iu" : "i"];

  return (ch) => odd.get(codeOf(ch)) ?? plainClass(ch);
};

const lowest = (members) =>
  members.reduce((low, ch) => (codeOf(ch) < codeOf(low) ? ch : low));

// One character standing for its whole class, worked out once a pattern.
// At most this many characters are remembered per table: past it, an answer
// is worked out again, so memory stays bounded whatever the data holds.
const MAX_REMEMBERED = 4096;

const remember = (seen, ch, answer) => {
  if (seen.size < MAX_REMEMBERED) {
    seen.set(ch, answer);
  }

  return answer;
};

export const memoised = (find) => {
  const seen = new Map();

  return (ch) => (seen.has(ch) ? seen.get(ch) : remember(seen, ch, find(ch)));
};

export const caseOf = (unicode) => {
  const members = memoised(membersOf(unicode));

  return { members, fold: memoised((ch) => lowest(members(ch))) };
};

// With i and u, \w also holds the characters that fold to a word character.
export const setsOf = ({ folding, unicode, members }) => {
  if (!(folding && unicode)) {
    return CLASS_ESCAPES;
  }

  const word = (ch) => members(ch).some(isWord);

  return { ...CLASS_ESCAPES, w: word, W: (ch) => !word(ch) };
};

const CONTROL_ESCAPES = { n: "\n", t: "\t", r: "\r", f: "\f", v: "\v" };

const SYNTAX = new Set([..."^$\\.*+?()[]{}|/-"]);

// ── Reading the pattern into a tree ──

const readerOf = (source, unicode) => {
  const chars = unicode ? [...source] : source.split("");
  let at = 0;

  return {
    peek: (ahead = 0) => chars[at + ahead],
    take: () => {
      const ch = chars[at];

      at += 1;

      return ch;
    },
    done: () => at >= chars.length,
    is: (ch) => chars[at] === ch,
    unicode,
    rest: () => chars.slice(at).join(""),
    skip: (count) => {
      at += count;
    },
  };
};

const hexOf = (read, length) => {
  const text = Array.from({ length }, () => read.take() ?? "").join("");

  failUnless(
    text.length === length && HEX.test(text),
    PATTERN_MESSAGES.invalid,
  );

  return String.fromCharCode(parseInt(text, 16));
};

const charNode = (ch) => ({ type: "char", ch });

const isLead = (ch) => /^[\ud800-\udbff]$/.test(ch);
const isTrail = (ch) => /^[\udc00-\udfff]$/.test(ch);

const TRAIL_ESCAPE = /^\\u([0-9a-fA-F]{4})/;

const lowOf = (found) =>
  found ? String.fromCharCode(parseInt(found[1], 16)) : "";

const trailOf = (read, ch) => {
  const found =
    read.unicode && isLead(ch) ? TRAIL_ESCAPE.exec(read.rest()) : null;
  const low = lowOf(found);

  return isTrail(low) ? { low, length: found[0].length } : null;
};

// Under u, a lead surrogate escape followed by a trail one is one character.
const unicodeEscapeOf = (read) => {
  const ch = hexOf(read, 4);
  const trail = trailOf(read, ch);

  if (!trail) {
    return ch;
  }

  read.skip(trail.length);

  return ch + trail.low;
};

const refusedEscape = (what) => () => fail(PATTERN_MESSAGES.unsupported(what));

const LETTER_ESCAPES = {
  u: (read) => charNode(unicodeEscapeOf(read)),
  x: (read) => charNode(hexOf(read, 2)),
  b: (_read, inClass) =>
    inClass ? charNode("\b") : { type: "assert", kind: "word" },
  B: (_read, inClass) =>
    inClass
      ? fail(PATTERN_MESSAGES.unsupported("\\B in a class"))
      : { type: "assert", kind: "notWord" },
  k: refusedEscape("a back-reference"),
  p: refusedEscape("a Unicode property"),
  P: refusedEscape("a Unicode property"),
  c: refusedEscape("\\c"),
};

const zeroOf = (read) =>
  isDigit(read.peek() ?? "")
    ? fail(PATTERN_MESSAGES.unsupported("an octal escape"))
    : charNode("\0");

// Under u, \- is an escape only inside a class, as RegExp has it.
const syntaxEscapeOf = (ch, read, inClass) =>
  ch === "-" && read.unicode && !inClass
    ? fail(PATTERN_MESSAGES.invalid)
    : charNode(ch);

const ESCAPE_KINDS = [
  [
    (ch) => Object.hasOwn(CLASS_ESCAPES, ch),
    (ch) => ({ type: "set", name: ch }),
  ],
  [
    (ch) => Object.hasOwn(CONTROL_ESCAPES, ch),
    (ch) => charNode(CONTROL_ESCAPES[ch]),
  ],
  [
    (ch) => Object.hasOwn(LETTER_ESCAPES, ch),
    (ch, read, inClass) => LETTER_ESCAPES[ch](read, inClass),
  ],
  [(ch) => /[1-9]/.test(ch), refusedEscape("a back-reference")],
  [(ch) => ch === "0", (_ch, read) => zeroOf(read)],
  [
    (ch) => SYNTAX.has(ch),
    (ch, read, inClass) => syntaxEscapeOf(ch, read, inClass),
  ],
];

const escapeOf = (read, inClass) => {
  const ch = read.take();

  failUnless(ch !== undefined, PATTERN_MESSAGES.invalid);

  const [, make] = ESCAPE_KINDS.find(([holds]) => holds(ch)) ?? [
    null,
    refusedEscape(`\\${ch}`),
  ];

  return make(ch, read, inClass);
};

const classAtom = (read) => {
  const ch = read.take();

  failUnless(ch !== undefined, PATTERN_MESSAGES.invalid);

  return ch === "\\" ? escapeOf(read, true) : charNode(ch);
};

const isRangeDash = (read) =>
  read.is("-") && ![undefined, "]"].includes(read.peek(1));

const rangeOf = (from, to) => {
  const valid =
    from.type === "char" &&
    to.type === "char" &&
    codeOf(from.ch) <= codeOf(to.ch);

  failUnless(valid, PATTERN_MESSAGES.invalid);

  return { type: "range", from: from.ch, to: to.ch };
};

const classItem = (read) => {
  const from = classAtom(read);

  if (!isRangeDash(read)) {
    return from;
  }

  read.take();

  return rangeOf(from, classAtom(read));
};

const classOf = (read) => {
  const negated = read.is("^") ? Boolean(read.take()) : false;
  const items = [];

  while (!read.is("]")) {
    failUnless(!read.done(), PATTERN_MESSAGES.invalid);
    items.push(classItem(read));
  }

  read.take();

  return { type: "class", negated, items };
};

const REFUSED_GROUPS = [
  ["?=", "a look-ahead"],
  ["?!", "a look-ahead"],
  ["?<=", "a look-behind"],
  ["?<!", "a look-behind"],
  ["?<", "a named group"],
];

const openGroup = (read) => {
  const refused = REFUSED_GROUPS.find(([opener]) =>
    read.rest().startsWith(opener),
  );

  if (refused) {
    fail(PATTERN_MESSAGES.unsupported(refused[1]));
  }

  if (read.is("?")) {
    read.take();
    failUnless(read.take() === ":", PATTERN_MESSAGES.invalid);
  }
};

const groupOf = (read, alternation) => {
  openGroup(read);

  const inner = alternation();

  failUnless(read.take() === ")", PATTERN_MESSAGES.invalid);

  return { type: "group", inner };
};

const ATOMS = {
  ".": () => ({ type: "any" }),
  "^": () => ({ type: "assert", kind: "start" }),
  $: () => ({ type: "assert", kind: "end" }),
  "\\": (read) => escapeOf(read, false),
  "[": (read) => classOf(read),
  "(": (read, alternation) => groupOf(read, alternation),
};

const BRACES = /^(\d+)(,(\d*))?\}/;

const maxOf = ([, min, comma, max]) => {
  if (comma === undefined) {
    return Number(min);
  }

  return max === "" ? Infinity : Number(max);
};

const checkBounds = ({ min, max }) => {
  failUnless(max >= min, PATTERN_MESSAGES.invalid);
  failUnless(
    (max === Infinity ? min : max) <= MAX_REPEAT,
    PATTERN_MESSAGES.repeat,
  );

  return { min, max };
};

const bracesOf = (read) => {
  const found = BRACES.exec(read.rest());

  failUnless(found !== null, PATTERN_MESSAGES.invalid);
  read.skip(found[0].length);

  return checkBounds({ min: Number(found[1]), max: maxOf(found) });
};

const QUANTIFIERS = {
  "?": () => ({ min: 0, max: 1 }),
  "*": () => ({ min: 0, max: Infinity }),
  "+": () => ({ min: 1, max: Infinity }),
  "{": bracesOf,
};

const isQuantifier = (ch) => ch !== undefined && Object.hasOwn(QUANTIFIERS, ch);

const quantified = (read, atom) => {
  if (!isQuantifier(read.peek())) {
    return atom;
  }

  failUnless(atom.type !== "assert", PATTERN_MESSAGES.invalid);

  const bounds = QUANTIFIERS[read.take()](read);

  if (read.is("?")) {
    read.take();
  }

  return { type: "repeat", inner: atom, ...bounds };
};

// Under u, a lone ] or } is no character, as RegExp has it.
const LONE_UNDER_U = new Set(["]", "{", "}"]);

const atomOf = (read, alternation) => {
  const ch = read.take();

  failUnless(!isQuantifier(ch), PATTERN_MESSAGES.invalid);
  failUnless(!(read.unicode && LONE_UNDER_U.has(ch)), PATTERN_MESSAGES.invalid);

  return Object.hasOwn(ATOMS, ch) ? ATOMS[ch](read, alternation) : charNode(ch);
};

const STOPS = new Set(["|", ")"]);

export const parseTree = (source, unicode) => {
  const read = readerOf(source, unicode);

  const sequence = () => {
    const items = [];

    while (!read.done() && !STOPS.has(read.peek())) {
      items.push(quantified(read, atomOf(read, alternation)));
    }

    return { type: "sequence", items };
  };

  const alternation = () => {
    const options = [sequence()];

    while (read.is("|")) {
      read.take();
      options.push(sequence());
    }

    return options.length === 1 ? options[0] : { type: "alternation", options };
  };

  const tree = alternation();

  failUnless(read.done(), PATTERN_MESSAGES.invalid);

  return tree;
};
