import { knownValuesOf } from "../../common/explore/describe.js";
import { logger } from "../../common/logger.js";
import { parsePath } from "../../common/explore/paths.js";
import { questionPaths } from "../explore/question-paths.js";
import { ownSources } from "../explore/sources.js";
import { buildVocabulary, sharedVersion } from "../explore/vocabulary.js";
import { findGrantQuestionSchemas } from "../../grants/services/config-version.service.js";
import {
  cwExploreFailure,
  findCwExploreSources,
} from "../repositories/cw-explore.repository.js";

const MINUTE_MS = 60 * 1000;
const ANSWERS_MINUTES = 5;
const ANSWERS_TTL_MS = ANSWERS_MINUTES * MINUTE_MS;
const CW_TTL_MS = MINUTE_MS;

let answers = null;
let cw = null;
let values = null;

const isFresh = (cached, ttl) =>
  cached !== null && Date.now() - cached.at < ttl;

const ANSWERS = "answers.";

const relative = (path) => path.slice(ANSWERS.length).replaceAll("[*]", "");

// Every answer path the grants' stored question schemas name, relative to
// the answers, once each, with the type the first schema gives it.
const answerPathsOf = (schemas) => {
  const paths = new Map();

  schemas.flatMap(questionPaths).forEach(({ path, type }) => {
    const answer = relative(path);

    if (parsePath(answer) && !paths.has(answer)) {
      paths.set(answer, { path: answer, ...(type && { type }) });
    }
  });

  return [...paths.values()];
};

const OUT_OF_TIME = Symbol("out of time");

// A read that outlasts `timeLeftMs` is answered as out of time; it goes on,
// and is kept when it ends. Its value or error, never a rejection.
const settledOf = (promise) =>
  promise.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );

const within = (reading, timeLeftMs) => {
  if (!Number.isFinite(timeLeftMs)) {
    return settledOf(reading);
  }

  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(resolve, Math.max(0, timeLeftMs), OUT_OF_TIME);
  });

  return settledOf(Promise.race([reading, late])).finally(() =>
    clearTimeout(timer),
  );
};

// One read at a time, shared by the requests that arrive while it runs.
const shared = (read) => {
  let reading = null;

  const start = () => {
    reading ??= read().finally(() => {
      reading = null;
    });

    return reading;
  };

  start.forget = () => {
    reading = null;
  };

  return start;
};

const readingAnswers = shared(async () => {
  const paths = answerPathsOf(await findGrantQuestionSchemas());

  answers = { at: Date.now(), paths };

  return paths;
});

const answerPathsFrom = ({ value, error }) => {
  if (error) {
    logger.warn("Explore answer paths not read");

    return [];
  }

  return value === OUT_OF_TIME ? [] : value;
};

// Answer paths are suggestions, not what may be read: without them a query
// still reads, and a failure is never kept.
const loadAnswers = async (timeLeftMs) =>
  isFresh(answers, ANSWERS_TTL_MS)
    ? answers.paths
    : answerPathsFrom(await within(readingAnswers(), timeLeftMs));

const readingCw = shared(async () => {
  const sources = await findCwExploreSources();

  if (sharedVersion(sources.versions) === null) {
    throw cwExploreFailure("ERRORED");
  }

  cw = { at: Date.now(), sources };

  return sources;
});

const cwFrom = ({ value, error }) => {
  if (error) {
    return { cw: null, cwFailure: error };
  }

  return value === OUT_OF_TIME
    ? { cw: null, cwFailure: cwExploreFailure("TIMED_OUT") }
    : { cw: value };
};

// A good answer is kept a minute; a failure never is.
const loadCw = async (timeLeftMs) =>
  isFresh(cw, CW_TTL_MS)
    ? { cw: cw.sources }
    : cwFrom(await within(readingCw(), timeLeftMs));

const NOT_ASKED = { cw: null, cwFailure: cwExploreFailure("ERRORED") };

const cwPartFor = (withCw, timeLeftMs) =>
  withCw ? loadCw(timeLeftMs) : NOT_ASKED;

// `withCw` false leaves Caseworking's sources unasked, for a query that
// reads none of them. `timeLeftMs` bounds both reads.
export const loadExploreVocabulary = async ({
  withCw = true,
  timeLeftMs = Infinity,
} = {}) => {
  const [paths, cwPart] = await Promise.all([
    loadAnswers(timeLeftMs),
    cwPartFor(withCw, timeLeftMs),
  ]);

  return buildVocabulary({ own: ownSources(), answers: paths, ...cwPart });
};

// The known values of GAS's own closed paths, by source then path, kept
// as long as the answer paths.
export const loadExploreValues = async () => {
  if (!isFresh(values, ANSWERS_TTL_MS)) {
    const sources = ownSources();
    const known = await Promise.all(sources.map(knownValuesOf));

    values = {
      at: Date.now(),
      bySource: new Map(sources.map(({ name }, n) => [name, known[n]])),
    };
  }

  return values.bySource;
};

// The editor's vocabulary is kept a minute, one missing a source only
// FAILED_MS. A kept one is answered at once and built again behind it; only
// the first waits, and requests that arrive while it is built share it.
export const VOCABULARY_MS = MINUTE_MS;
export const FAILED_MS = 10_000;

let kept = null;
let building = null;

const keep = ({ vocabulary, failed }) => {
  kept = {
    vocabulary,
    expiresAt: Date.now() + (failed ? FAILED_MS : VOCABULARY_MS),
  };

  return vocabulary;
};

const buildWith = (build) => {
  building ??= build()
    .then(keep)
    .finally(() => {
      building = null;
    });

  return building;
};

// `build` answers `{ vocabulary, failed }`; `failed` keeps it a short while.
export const keptVocabulary = (build) => {
  if (!kept) {
    return buildWith(build);
  }

  if (Date.now() >= kept.expiresAt) {
    buildWith(build).catch(() => {});
  }

  return Promise.resolve(kept.vocabulary);
};

export const forgetExploreVocabulary = () => {
  answers = null;
  cw = null;
  values = null;
  readingAnswers.forget();
  readingCw.forget();
  kept = null;
  building = null;
};
