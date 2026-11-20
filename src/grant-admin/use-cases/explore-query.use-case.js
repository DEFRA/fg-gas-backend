import Boom from "@hapi/boom";
import { oneOperatorAtATime, withRoom } from "../../common/explore/busy.js";
import { TOO_MANY_COMBINATIONS } from "../../common/explore/index-tests.js";
import { decodePositions } from "../../common/explore/merge.js";
import { meterFor, timeLeftOf } from "../../common/explore/meter.js";
import { refusalOf } from "../../common/explore/refusal.js";
import { logger } from "../../common/logger.js";
import {
  PMC_0706_SECURITY,
  auditActions,
  auditEntities,
} from "../../events/audit-constants.js";
import { auditedRead } from "../../events/audited-read.js";
import { buildAuditEvent } from "../../events/with-audit.js";
import { answerFrom, unseenPaths } from "../explore/answer.js";
import { narrowingPaths, windowedMessage } from "../explore/check.js";
import {
  UNTIL_END,
  asQueryPositions,
  isLimitTyped,
  limitOf,
  readCsvWindows,
} from "../explore/csv.js";
import { partsOf } from "../explore/federate.js";
import { readQuery } from "../explore/language/query.js";
import { findOwnSource } from "../explore/sources.js";
import { readsCaseworking } from "../explore/vocabulary.js";
import { readAnswerWindows } from "../explore/windows.js";
import { queryCwExplore } from "../repositories/cw-explore.repository.js";
import { exploreVocabularyUseCase } from "./explore-vocabulary.use-case.js";
import { loadExploreVocabulary } from "./load-explore-vocabulary.js";

const BAD_REQUEST = 400;
const TOO_SLOW = 408;
const TOO_MANY_REQUESTS = 429;

// One deadline for the whole request, CSV windows and Caseworking's part too,
// kept below GPA's own timeout so GAS answers first.
const REQUEST_MS = 10_000;

const SERVICES = { GAS: "The Grant Application Service", CW: "Caseworking" };

// ── Answers that aren't rows ──

// The payload is the whole answer; the error's own message names only why.
// Each is an answer to what was asked, logged as one, never as a failure.
const answerWith = (statusCode, payload, logLevel = "info") => {
  const error = new Boom.Boom(payload.reason, {
    statusCode,
    data: { logLevel },
  });

  error.output.payload = { statusCode, ...payload };

  return error;
};

const queryInvalid = (error) =>
  answerWith(BAD_REQUEST, { reason: "QUERY_INVALID", error });

// The indexed paths that would narrow the query, never one it already tests:
// with none left, simpler conditions are the way.
const narrowWith = (source, where) => {
  const paths = narrowingPaths(source, where, { untested: true });

  return paths.length
    ? `Narrow it with an indexed path: ${paths.join(", ")}`
    : "Narrow it with fewer or simpler conditions";
};

const NO_DETAIL = { why: TOO_MANY_COMBINATIONS, path: null };

const REFUSED = {
  TOO_MANY_TO_COUNT: ({ source, who, where }) =>
    `${who} has too many records to count. ${narrowWith(source, where)}`,
  TOO_MANY_TO_SORT: ({ source, who, where }) =>
    `${who} has too many records to sort. ${narrowWith(source, where)}`,
  TOO_BIG: ({ source, who, detail }) =>
    `${who} has too many ${detail?.noun ?? source.noun.many} to read in full`,
  GROUP_NEEDS_EXACT: ({ source, query, detail }) =>
    windowedMessage("GROUP_NEEDS_EXACT", {
      source,
      query,
      detail: detail ?? NO_DETAIL,
    }),
  ORDER_NEEDS_EXACT: ({ source, query, detail }) =>
    windowedMessage("ORDER_NEEDS_EXACT", {
      source,
      query,
      detail: detail ?? NO_DETAIL,
    }),
  BAD_POSITION: () => "These results can’t be continued. Run the query again",
  INVALID: () => "This query can’t be read",
  PATH_NOT_ALLOWED: ({ who }) =>
    `${who} can’t read a malformed path in this query`,
};

const ANSWERS = {
  BUSY: ({ service }) =>
    answerWith(TOO_MANY_REQUESTS, {
      reason: "QUERY_BUSY",
      refusal: "BUSY",
      message:
        "You already have a query running. Wait for it to finish, then try again.",
      service,
    }),
  FULL: ({ who, service }) =>
    answerWith(TOO_MANY_REQUESTS, {
      reason: "QUERY_BUSY",
      refusal: "FULL",
      message: `${who} is running as many queries as it can. Try again in a moment.`,
      service,
    }),
  TOO_SLOW: ({ source, who, where, service }) =>
    answerWith(TOO_SLOW, {
      reason: "QUERY_TOO_SLOW",
      message: `${who} took too long. ${narrowWith(source, where)}`,
      service,
    }),
  TOO_COSTLY: ({ source, who, where, service }) =>
    answerWith(TOO_SLOW, {
      reason: "QUERY_TOO_SLOW",
      message: `${who} would take too long. ${narrowWith(source, where)}`,
      service,
    }),
};

const refused = (code, refusal) =>
  Object.hasOwn(ANSWERS, code)
    ? ANSWERS[code](refusal)
    : answerWith(BAD_REQUEST, {
        reason: "QUERY_REFUSED",
        message: REFUSED[code](refusal),
        service: refusal.service,
      });

// A refusal answers with the service that refused it, GAS or Caseworking.
const NO_QUERY = { mode: null, where: null };

const answerOfError = (source, query) => (error) => {
  const code = refusalOf(error);
  const service = error.service ?? "GAS";

  throw code
    ? refused(code, {
        source,
        query,
        where: query.where,
        service,
        who: SERVICES[service],
        detail: error.detail,
      })
    : error;
};

// ── Reading the parts ──

const cwPart = (query, run) => {
  if (run.cwFailure) {
    throw run.cwFailure;
  }

  return queryCwExplore(query, {
    actor: run.actor,
    timeLeftMs: timeLeftOf(run.meter),
    signal: run.stop.signal,
  });
};

const readAnswer = async ({ query, run, csv, target, shows }) => {
  const answered =
    csv && target
      ? await readCsvWindows(query, run, target)
      : { parts: await partsOf(query, run) };

  return {
    ...answerFrom({
      source: run.source,
      query: { ...query, limit: shows },
      parts: answered.parts,
      merged: answered.merged,
      partial: answered.partial,
    }),
    unseen: unseenPaths(run.source, query),
  };
};

// ── The audit ──

const reasonOf = (error) =>
  refusalOf(error) ?? (error.output ? error.output.payload.reason : null);

const answeredAs = (result) => (result.partial ? "PARTIAL" : "ANSWERED");

const outcomeOf = (error, result) =>
  error ? (reasonOf(error) ?? "FAILED") : answeredAs(result);

// A caller that went away while the query read is its own outcome, however
// the read then ended.
const auditedOutcome = (run, error, result) =>
  run.gone?.aborted ? "ABORTED" : outcomeOf(error, result);

// That a person queried a source, how it ended and what it gave them; never
// what was asked.
const buildExploreAudit = ({ run, csv }, result, error) =>
  buildAuditEvent({
    entity: auditEntities.EXPLORE_SOURCE,
    action: auditActions.EXPLORE_QUERY,
    entityid: run.source.name,
    details: {
      source: run.source.name,
      resultCount: result ? result.rows.length : null,
      csv,
      outcome: auditedOutcome(run, error, result),
    },
    security: PMC_0706_SECURITY,
    segregationRef: "admin-explore",
  });

const auditedAnswer = auditedRead(readAnswer, buildExploreAudit);

// ── The query ──

const positionsIn = (text) =>
  text === undefined || text === null ? null : decodePositions(text);

// The vocabulary is loaded within the request's deadline, Caseworking's
// sources only for a query that may read one.
const checked = async (text, meter) => {
  const vocabulary = await loadExploreVocabulary({
    withCw: readsCaseworking(text),
    timeLeftMs: timeLeftOf(meter),
  });
  const result = readQuery(text, vocabulary);

  if (result.error) {
    throw queryInvalid(result.error);
  }

  return { ...result, vocabulary };
};

const runOf = ({ source, vocabulary, actor, meter, stop, signal }) => ({
  source,
  gone: signal ?? null,
  own: findOwnSource(source.name),
  actor,
  meter,
  stop,
  cwPart,
  cwFailure: vocabulary.unavailable.get("cases") ?? null,
});

// A request stops at its next check, Caseworking's part too, when the
// caller gives up, has already, or another part has failed.
const stopper = (signal, meter) => {
  const stop = new AbortController();

  stop.signal.addEventListener("abort", () => {
    meter.deadline = 0;
  });

  if (signal?.aborted) {
    stop.abort();
  } else {
    signal?.addEventListener("abort", () => stop.abort());
  }

  return stop;
};

const targetOf = (body) =>
  body.csv && body.untilEnd ? UNTIL_END : positionsIn(body.positions);

const queryPositions = (csv, target) =>
  csv || target === null
    ? { positions: null }
    : { positions: asQueryPositions(target), window: true };

const read = async ({ body, actor, signal }, checkedQuery, meter) => {
  const { query, source, tree, vocabulary } = checkedQuery;
  const target = targetOf(body);
  const { limit, shows } = limitOf({
    body,
    query,
    typed: isLimitTyped(tree),
    target,
  });
  const csv = Boolean(body.csv);
  const stop = stopper(signal, meter);

  logger.info(`Explore query on ${source.name}`);

  const result = await auditedAnswer({
    query: {
      ...query,
      limit,
      ...queryPositions(csv, target),
    },
    run: runOf({ source, vocabulary, actor, meter, stop, signal }),
    csv,
    target,
    shows,
  })
    .catch((error) => {
      stop.abort();
      throw error;
    })
    .catch(answerOfError(source, query));

  logger.info(`Finished: Explore query (${result.rows.length} rows)`);

  return result;
};

// Caseworking's sources are read there: they count against its own room
// here, never GAS's.
const poolOf = (source) => (source.service === "CW" ? "CW" : "GAS");

// ── Windows in turn ──

const UNEXPECTED = { statusCode: 500, payload: { reason: "FAILED" } };

const stoppedBy = (error) => {
  const { statusCode, payload } = error.output ?? UNEXPECTED;

  if (!error.output) {
    logger.error(`Explore query window failed: ${error.message}`);
  }

  return { statusCode, code: payload.reason ?? UNEXPECTED.payload.reason };
};

// `windows` reads the first window, then each from where the last ended,
// each audited as one query.
const readWindows = (args, checkedQuery, meter) => {
  const { body } = args;

  if (body.windows === undefined) {
    return read(args, checkedQuery, meter);
  }

  const { query, tree } = checkedQuery;
  const { limit } = limitOf({
    body,
    query,
    typed: isLimitTyped(tree),
    target: null,
  });

  return readAnswerWindows({
    body,
    query,
    limit,
    meter,
    readAnswer: (windowBody) =>
      read({ ...args, body: windowBody }, checkedQuery, meter),
    stoppedBy,
  });
};

const answer = async (args) => {
  const meter = meterFor(Date.now() + REQUEST_MS);
  const checkedQuery = await checked(args.body.query, meter);
  const { source } = checkedQuery;

  if (args.body.check) {
    return { ok: true, source: source.name };
  }

  return withRoom(poolOf(source), () => readWindows(args, checkedQuery, meter));
};

// The editor's vocabulary, beside an answer or a refusal alike; null when it
// can't be read, so the answer still stands.
const vocabularyFor = () =>
  exploreVocabularyUseCase().catch((error) => {
    logger.warn(`Explore vocabulary not read: ${error.message}`);

    return null;
  });

const withVocabulary = (answering, vocabulary) =>
  answering.then(
    async (answered) => ({ ...answered, vocabulary: await vocabulary }),
    async (error) => {
      if (error.output) {
        error.output.payload.vocabulary = await vocabulary;
      }

      throw error;
    },
  );

// One query, checked, then read where its source lives; refused while the
// same operator's last one still runs.
export const exploreQueryUseCase = (args) =>
  withVocabulary(
    oneOperatorAtATime(args.actorId, () => answer(args)).catch(
      answerOfError(null, NO_QUERY),
    ),
    vocabularyFor(),
  );
