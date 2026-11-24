import { describeSource } from "../../common/explore/describe.js";
import { SOURCES } from "./language/allowlist.js";
import { lex } from "./language/lex.js";

// The sources Caseworking owns: refused with its failure when it didn't answer.
export const CW_SOURCES = ["cases", "workflows"];

const isWord = (token, word) => token?.k === "word" && token.v === word;

const isKind = (token, kind) => token?.k === kind;

const isHead = ([db, dot, name]) =>
  isWord(db, "db") && isKind(dot, ".") && isKind(name, "word");

// The source a query's text names, as `db.<source>` starts it, or null.
const namedSourceOf = (text) => {
  const tokens = lex(text).filter(({ k }) => k !== "comment");

  return isHead(tokens) ? tokens[2].v : null;
};

// Whether a query's text may read a source of Caseworking's: one of its own,
// or events, which reads its boxes too.
export const readsCaseworking = (text) => {
  const name = namedSourceOf(text);

  return CW_SOURCES.includes(name) || name === "events";
};

// The most paths a source suggests, its own first.
const MAX_PATHS = 2000;

const answerPath =
  (answersAt) =>
  ({ path, type }) => ({
    path: `${answersAt}.${path}`,
    type,
    index: null,
    closed: false,
    within: null,
  });

const entryOf = (described, answers) => {
  const paths = new Map(described.paths.map((entry) => [entry.path, entry]));

  if (described.answersAt) {
    answers
      .map(answerPath(described.answersAt))
      .filter(({ path }) => !paths.has(path))
      .slice(0, Math.max(0, MAX_PATHS - paths.size))
      .forEach((entry) => paths.set(entry.path, entry));
  }

  return { ...described, paths };
};

const cwEntries = (cw) =>
  cw
    ? cw.sources.filter(
        ({ name, service }) => service === "CW" && CW_SOURCES.includes(name),
      )
    : [];

// Every source a query may name, with the paths it suggests: GAS's own,
// Caseworking's as it describes them, and the answer paths of each source
// with answers. `answers` are the grants' question paths, relative to the
// answers; `cw` is Caseworking's sources answer, or null with `cwFailure`
// why not.
export const buildVocabulary = ({ own, answers, cw, cwFailure }) => {
  const sources = [
    ...own.map((source) => entryOf(describeSource(source), answers)),
    ...cwEntries(cw).map((source) => entryOf(source, answers)),
  ];

  return {
    sources: new Map(sources.map((source) => [source.name, source])),
    unavailable: new Map(cw ? [] : CW_SOURCES.map((name) => [name, cwFailure])),
  };
};

const valuesOf = (values, { path, values: described }) => {
  const known = values.get(path) ?? described;

  return known ? { values: known } : {};
};

const publicPath = (values) => (entry) => ({
  path: entry.path,
  ...(entry.type && { type: entry.type }),
  indexed: entry.index !== null,
  ...valuesOf(values, entry),
});

const inOrder = (sources) =>
  [...sources].sort(
    (a, b) => SOURCES.indexOf(a.name) - SOURCES.indexOf(b.name),
  );

// The vocabulary as the editor reads it, its sources in the order a query
// lists them.
// `values` holds GAS's own sources' known values, by source and path;
// Caseworking's come with its paths.
export const publicVocabulary = (vocabulary, values) => ({
  sources: inOrder(vocabulary.sources.values()).map(
    ({ name, label, time, paths }) => ({
      name,
      label,
      time,
      paths: [...paths.values()].map(publicPath(values.get(name) ?? new Map())),
    }),
  ),
});
