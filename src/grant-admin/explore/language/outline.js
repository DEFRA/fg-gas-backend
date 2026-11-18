import { CHAINED, METHODS, OPERATORS } from "./allowlist.js";

// The editor's shape checks (qeCheck), in its order and with its words, so
// that where both see a problem they name the same one at the same place.
export const listOf = (names) =>
  names.length < 2
    ? names.join("")
    : `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;

const METHOD_NAMES = [...METHODS.keys()];

const asCall = (name) => `.${name}(…)`;

export const OUTLINE_MESSAGES = {
  bad: (text) => `“${text}” isn’t part of a query`,
  pattern: "This pattern isn’t closed: add /",
  text: (quote) => `This text isn’t closed: add ${quote}`,
  closesNothing: (k) => `This ${k} closes nothing`,
  notClosed: (k, closer) => `This ${k} isn’t closed: add ${closer}`,
  start: (first) =>
    `Start with db. and what to look in: db.${first}.find({ … })`,
  dot: "Add . after db",
  source: (names) => `db.${listOf(names)}`,
  method: `A method goes here: ${listOf(METHOD_NAMES)}`,
  chained: "Then .sort({ … }) or .limit(…)",
  operator: (word) => `${word} isn’t one of the operators you can use`,
  noMethod: `Add a method: ${listOf(METHOD_NAMES.map(asCall))}`,
};

const CLOSERS = { "(": ")", "[": "]", "{": "}" };
const OPENERS = { ")": "(", "]": "[", "}": "{" };

const problemAt = (text, token, message) =>
  token
    ? { message, at: token.at, end: token.end }
    : { message, at: text.length, end: text.length + 1 };

const lexical = (tokens) => {
  const bad = tokens.find(({ k }) => k === "bad");

  if (bad) {
    return [bad, OUTLINE_MESSAGES.bad(bad.text)];
  }

  const open = tokens.find(
    ({ k, closed }) => ["str", "re"].includes(k) && !closed,
  );

  if (open) {
    return [
      open,
      open.k === "re"
        ? OUTLINE_MESSAGES.pattern
        : OUTLINE_MESSAGES.text(open.text[0]),
    ];
  }

  return null;
};

// True for a closer that doesn't close the last opener.
const bracketStep = (opens, token) => {
  if (Object.hasOwn(CLOSERS, token.k)) {
    opens.push(token);

    return false;
  }

  return Object.hasOwn(OPENERS, token.k) && opens.pop()?.k !== OPENERS[token.k];
};

const brackets = (tokens) => {
  const opens = [];
  const stray = tokens.find((token) => bracketStep(opens, token));

  if (stray) {
    return [stray, OUTLINE_MESSAGES.closesNothing(stray.k)];
  }

  const open = opens.at(-1);

  return open
    ? [open, OUTLINE_MESSAGES.notClosed(open.k, CLOSERS[open.k])]
    : null;
};

const isSource = (token, sources) =>
  token?.k === "word" && sources.includes(token.v);

const HEAD = [
  [
    (tokens) => tokens[0].k !== "word" || tokens[0].v !== "db",
    (tokens, sources) => [tokens[0], OUTLINE_MESSAGES.start(sources[0])],
  ],
  [
    (tokens) => tokens[1]?.k !== ".",
    (tokens) => [tokens[1], OUTLINE_MESSAGES.dot],
  ],
  [
    (tokens, sources) => !isSource(tokens[2], sources),
    (tokens, sources) => [tokens[2], OUTLINE_MESSAGES.source(sources)],
  ],
];

const head = (tokens, sources) => {
  const found = HEAD.find(([fails]) => fails(tokens, sources));

  return found ? found[1](tokens, sources) : null;
};

const isCall = (tokens, n) =>
  tokens[n].k === "word" && tokens[n - 1]?.k === "." && n > 2;

const callProblem = (tokens, n) => {
  const first = tokens[n - 2] === tokens[2];
  const known = first ? METHODS.has(tokens[n].v) : CHAINED.has(tokens[n].v);

  if (known) {
    return null;
  }

  return [
    tokens[n],
    first ? OUTLINE_MESSAGES.method : OUTLINE_MESSAGES.chained,
  ];
};

const isUnknownOperator = (token) =>
  token.k === "word" && token.v.startsWith("$") && !OPERATORS.has(token.v);

const tokenProblem = (tokens, n) => {
  if (isCall(tokens, n)) {
    return callProblem(tokens, n);
  }

  return isUnknownOperator(tokens[n])
    ? [tokens[n], OUTLINE_MESSAGES.operator(tokens[n].v)]
    : null;
};

const walk = (tokens) => {
  for (let n = 0; n < tokens.length; n += 1) {
    const problem = tokenProblem(tokens, n);

    if (problem) {
      return problem;
    }
  }

  return tokens.some((_, n) => isCall(tokens, n))
    ? null
    : [undefined, OUTLINE_MESSAGES.noMethod];
};

const firstProblem = (tokens, sources) =>
  lexical(tokens) ?? brackets(tokens) ?? head(tokens, sources) ?? walk(tokens);

// The first shape problem of a query, as { message, at, end }, or null.
// `sources` are the names a query may look in, in the vocabulary's order.
export const outlineProblem = (text, allTokens, sources) => {
  const tokens = allTokens.filter(({ k }) => k !== "comment");
  const found = tokens.length
    ? firstProblem(tokens, sources)
    : [undefined, OUTLINE_MESSAGES.start(sources[0])];

  return found ? problemAt(text, found[0], found[1]) : null;
};
