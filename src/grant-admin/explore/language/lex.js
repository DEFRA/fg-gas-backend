// The words of a query as GPA's query editor cuts them:
// quoted text, patterns, numbers, words and $operators, punctuation and
// comments, each with where it starts and ends. Anything else is a "bad"
// token of one character.
const PUNCTUATION = new Set([..."{}[]():,.;"]);
const NUMBER = /-?\d+(\.\d+)?/y;
const WORD = /\$?[A-Za-z_]\w*/y;
const FLAGS = /[a-z]*/y;
const SPACE = /\s/;
const PATTERN_AFTER = new Set([":", ",", "[", "("]);

const matchAt = (pattern, text, at) => {
  pattern.lastIndex = at;

  return pattern.exec(text);
};

// A backslash escapes the next character, a line break included; one at the
// very end is kept as it is.
const STRING_BODIES = new Map([
  ["'", /(?:\\[\s\S]|\\$|[^'\\\n])*/y],
  ['"', /(?:\\[\s\S]|\\$|[^"\\\n])*/y],
]);
const PATTERN_BODY = /(?:\\[\s\S]?|[^/\\\n])*/y;

const quoted = (text, at) => {
  const quote = text[at];
  const body = matchAt(STRING_BODIES.get(quote), text, at + 1)[0];
  const end = at + 1 + body.length;
  const closed = text[end] === quote;

  return {
    k: "str",
    v: body.replace(/\\([\s\S])/g, "$1"),
    closed,
    end: closed ? end + 1 : end,
  };
};

const patternAt = (text, at) => {
  const source = matchAt(PATTERN_BODY, text, at + 1)[0];
  const end = at + 1 + source.length;
  const closed = text[end] === "/";
  const afterSlash = closed ? end + 1 : end;
  const flags = matchAt(FLAGS, text, afterSlash)[0];

  return { k: "re", v: source, flags, closed, end: afterSlash + flags.length };
};

const commentAt = (text, at) => {
  const end = text.indexOf("\n", at);

  return { k: "comment", end: end < 0 ? text.length : end };
};

// A / starts a pattern where a value can: at the start, or after : , [ (.
// Comments don't count, so a pattern after one is still a pattern.
const startsPattern = (previous) => !previous || PATTERN_AFTER.has(previous.k);

const isGlued = (previous, at) =>
  Boolean(previous) && previous.k === "word" && previous.end === at;

const numberAt = (text, at, previous) => {
  const found = isGlued(previous, at) ? null : matchAt(NUMBER, text, at);

  return found && { k: "num", v: Number(found[0]), end: at + found[0].length };
};

const wordAt = (text, at) => {
  const found = matchAt(WORD, text, at);

  return found && { k: "word", v: found[0], end: at + found[0].length };
};

const READERS = [
  (text, at) => (text.startsWith("//", at) ? commentAt(text, at) : null),
  (text, at) =>
    text[at] === "'" || text[at] === '"' ? quoted(text, at) : null,
  (text, at, previous) =>
    text[at] === "/" && startsPattern(previous) ? patternAt(text, at) : null,
  numberAt,
  wordAt,
  (text, at) =>
    PUNCTUATION.has(text[at]) ? { k: text[at], end: at + 1 } : null,
  (_text, at) => ({ k: "bad", end: at + 1 }),
];

const tokenAt = (text, at, previous) => {
  for (const read of READERS) {
    const token = read(text, at, previous);

    if (token) {
      return { ...token, at, text: text.slice(at, token.end) };
    }
  }

  return null;
};

export const lex = (text) => {
  const tokens = [];
  let previous = null;
  let at = 0;

  while (at < text.length) {
    if (SPACE.test(text[at])) {
      at += 1;
    } else {
      const token = tokenAt(text, at, previous);

      tokens.push(token);
      previous = token.k === "comment" ? previous : token;
      at = token.end;
    }
  }

  return tokens;
};
