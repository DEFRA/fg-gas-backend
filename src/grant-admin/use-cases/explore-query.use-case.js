import { oneOperatorAtATime, withRoom } from "../../common/explore/busy.js";
import {
  cellsAllowanceOf,
  costOfAll,
  isSpent,
  less,
  rowCostOf,
} from "../../common/explore/cells-allowance.js";
import { decodePositions } from "../../common/explore/merge.js";
import { meterFor, timeLeftOf } from "../../common/explore/meter.js";
import { DOWNLOAD_BYTES, STARTS } from "../../common/explore/query-schema.js";
import { refusalOf } from "../../common/explore/refusal.js";
import { logger } from "../../common/logger.js";
import {
  PMC_0706_SECURITY,
  auditActions,
  auditEntities,
} from "../../events/audit-constants.js";
import { auditedRead, auditedStream } from "../../events/audited-read.js";
import { buildAuditEvent } from "../../events/with-audit.js";
import { answerFrom, limitsOf, unseenPaths } from "../explore/answer.js";
import {
  UNTIL_END,
  asQueryPositions,
  downloadOf,
  isLimitTyped,
  limitOf,
  raiseOf,
  readCsvWindows,
  withoutDownloadFacts,
} from "../explore/csv.js";
import {
  withShownDocument,
  withStarts,
  withoutDocuments,
} from "../explore/documents.js";
import { partsOf } from "../explore/federate.js";
import { readQuery } from "../explore/language/query.js";
import { isShownGone, showQueryOf, shownOnly } from "../explore/show.js";
import { findOwnSource } from "../explore/sources.js";
import { downloadEnding, downloadLines } from "../explore/stream.js";
import { readsCaseworking } from "../explore/vocabulary.js";
import { readAnswerWindows } from "../explore/windows.js";
import { queryCwExplore } from "../repositories/cw-explore.repository.js";
import { ndjsonOf } from "../services/ndjson.js";
import {
  BAD_REQUEST,
  NO_QUERY,
  answerOfError,
  answerWith,
  queryInvalid,
} from "./explore-answers.js";
import { exploreVocabularyUseCase } from "./explore-vocabulary.use-case.js";
import { loadExploreVocabulary } from "./load-explore-vocabulary.js";

// One deadline for the whole request, CSV windows and Caseworking's part too,
// kept below GPA's own timeout so GAS answers first.
const REQUEST_MS = 10_000;

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

const partsAnswered = async ({ query, run, csv, target }) =>
  csv && target
    ? readCsvWindows(query, run, target)
    : { parts: await partsOf(query, run) };

// A page's starts are fetched with its rows, and Show it's document; a
// stream's documents as it is written.
const documentsOf = (answer, { query, run, stream, shorter }) => {
  if (!query.documents) {
    return withoutDocuments(answer);
  }

  if (stream) {
    return answer;
  }

  return query.documents.mode === STARTS
    ? withStarts(answer, { query, run, shorter })
    : withShownDocument(answer, { query, run });
};

// The cells allowance is shared by every window of one request; a download
// holds its own.
const cellsAllowanceFor = (csv, budget) =>
  csv ? cellsAllowanceOf(DOWNLOAD_BYTES) : budget.cells;

// Show it's answer is its one row, and says whether the record is gone.
const shownAnswer = (answer, show) => (show ? shownOnly(answer, show) : answer);

const withShownGone = (answer, query) => {
  const { cut, ...shown } = answer;

  return {
    ...shown,
    documents: {
      ...(answer.documents ?? { whole: query.documents.whole, bytes: 0 }),
      gone: isShownGone(answer),
    },
  };
};

const withShown = (answer, { show, query }) =>
  show ? withShownGone(answer, query) : answer;

const readAnswer = async (asked) => {
  const { query, run, csv, target, shows, typed, raise, budget } = asked;

  const answered = await partsAnswered({ query, run, csv, target });
  const allowance = cellsAllowanceFor(csv, budget);
  const answerOf = (limit) =>
    shownAnswer(
      answerFrom({
        source: run.source,
        query: { ...query, limit },
        parts: answered.parts,
        merged: answered.merged,
        partial: answered.partial,
        allowance,
        cut: csv,
      }),
      asked.show,
    );
  const answer = answerOf(shows);
  const withDocs = withShown(
    await documentsOf(answer, {
      ...asked,
      query: asked.fetchQuery,
      shorter: answerOf,
    }),
    asked,
  );

  budget.cells = less(budget.cells, costOfAll(withDocs.rows, rowCostOf));

  return {
    ...withoutDownloadFacts(withDocs),
    unseen: unseenPaths(run.source, query),
    limits: limitsOf(query, raise),
    ...(csv && {
      download: downloadOf(answered, answer, { typed, shows }),
    }),
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

// The rows a query gave: a stream's, those it sent.
const resultCountOf = (result) => result.sent ?? result.rows.length;

// The file a read was for: a download streamed is Download JSON's.
const downloadFormatOf = ({ csv, stream }) => {
  if (!csv) {
    return null;
  }

  return stream ? "JSON" : "CSV";
};

// That a person queried a source, how it ended and what it gave them; never
// what was asked. `download` names the file it was read for, if any.
const buildExploreAudit = ({ run, csv, stream }, result, error) =>
  buildAuditEvent({
    entity: auditEntities.EXPLORE_SOURCE,
    action: auditActions.EXPLORE_QUERY,
    entityid: run.source.name,
    details: {
      source: run.source.name,
      resultCount: result ? resultCountOf(result) : null,
      download: downloadFormatOf({ csv, stream }),
      outcome: auditedOutcome(run, error, result),
    },
    security: PMC_0706_SECURITY,
    segregationRef: "admin-explore",
  });

const auditedAnswer = auditedRead(readAnswer, buildExploreAudit);

const auditedDownload = auditedStream(readAnswer, buildExploreAudit);

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

// With documents or starts, the Query says what a document is, and rows
// carry their records' sizes; a download's cells may fill it.
const askedQueryOf = (body, { query, shape }, csv) => ({
  ...query,
  ...(body.documents && { documents: shape }),
  ...(body.starts && { documents: { ...shape, mode: STARTS } }),
  ...(csv && { cellBytes: DOWNLOAD_BYTES }),
});

// What one read asks, page, CSV or stream alike.
const showRefused = (message) =>
  answerWith(BAD_REQUEST, { reason: "QUERY_REFUSED", message, service: "GAS" });

// Show it reads the run's row again with its record's document: by its
// `_id`, its own filter kept to test the record on as fetched.
const shownOf = (body, checkedQuery) => {
  if (!body.show) {
    return { body, checkedQuery, show: null };
  }

  const { query, error } = showQueryOf(checkedQuery, body.show);

  if (error) {
    throw showRefused(error);
  }

  return {
    body: { ...body, documents: true },
    checkedQuery: { ...checkedQuery, query },
    show: { ...body.show, filter: checkedQuery.query.where },
  };
};

// What the fetch tests each record on: the run's own filter for Show it.
const fetchQueryOf = (query, show) =>
  show ? { ...query, where: show.filter } : query;

const askedRead = (args, asked, meter) => {
  const { actor, signal, budget } = args;
  const { body, checkedQuery, show } = shownOf(args.body, asked);
  const { query, source, tree, vocabulary } = checkedQuery;
  const target = targetOf(body);
  const typed = isLimitTyped(tree);
  const { limit, shows } = limitOf({ body, query, typed, target });
  const csv = Boolean(body.csv);

  const queryToRead = {
    ...askedQueryOf(body, checkedQuery, csv),
    limit,
    ...queryPositions(csv, target),
  };

  return {
    query: queryToRead,
    fetchQuery: fetchQueryOf(queryToRead, show),
    show,
    run: runOf({
      source,
      vocabulary,
      actor,
      meter,
      stop: stopper(signal, meter),
      signal,
    }),
    csv,
    target,
    shows,
    typed,
    raise: raiseOf(tree),
    budget,
    stream: Boolean(body.stream),
  };
};

// A failed read stops what else is still reading, and is answered as the
// service that refused it says.
const answeredRead = (reading, asked, { source, query, spans }) =>
  reading
    .catch((error) => {
      asked.run.stop.abort();
      throw error;
    })
    .catch(answerOfError(source, query, spans));

const documentsLine = (result) =>
  result.documents ? `, documents.bytes ${result.documents.bytes}` : "";

const read = async (args, checkedQuery, meter) => {
  const asked = askedRead(args, checkedQuery, meter);

  logger.info(`Explore query on ${checkedQuery.source.name}`);

  const result = await answeredRead(auditedAnswer(asked), asked, checkedQuery);

  logger.info(
    `Finished: Explore query (${result.rows.length} rows${documentsLine(result)})`,
  );

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
// each audited as one query, with its documents.
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
    hasCellsLeft: () => !isSpent(args.budget.cells),
  });
};

// What one request may hold, shared by its windows: the cells.
const budgetOf = () => ({ cells: cellsAllowanceOf(undefined) });

// ── Download JSON, streamed ──

const streamLine = (ending) =>
  `Finished: Explore download (${ending.sent} rows${ending.done ? "" : ", cut off"})`;

// Why a download ended short of its end line, or a caller that went away
// at any point: one outcome, ABORTED, however far it got.
const brokenOff = () => new Error("Explore download ended before its end");

const callerGone = () => new Error("Explore download's caller went away");

const unfinished = (ending) => (ending.done ? null : brokenOff());

const endingError = (ending, run) => {
  if (run.gone?.aborted) {
    return callerGone();
  }

  return ending.error ?? unfinished(ending);
};

// The download read as a CSV is, then streamed: a refusal comes before the
// first byte, audited as any read's; the caller is handed the stream once
// the rows are read, and the room stays taken until it ends, when it is
// audited with the rows it sent.
const streamRead = async (args, checkedQuery, meter, handed) => {
  const asked = askedRead(args, checkedQuery, meter);

  logger.info(`Explore download on ${checkedQuery.source.name}`);

  const download = auditedDownload(asked);
  const answer = await answeredRead(download.read(), asked, checkedQuery);
  const ending = downloadEnding();
  const ended = Promise.withResolvers();
  const lines = downloadLines(answer, {
    query: asked.fetchQuery,
    run: asked.run,
    ending,
  });

  handed.resolve({
    stream: ndjsonOf(lines, async () => {
      const error = endingError(ending, asked.run);

      await download.ended(
        { sent: ending.sent, partial: ending.stopped !== null },
        error,
      );
      logger.info(streamLine(ending));
      ended.resolve();
    }),
  });

  await ended.promise;
};

// ── One query ──

// The query checked, then, unless only its check was asked, read where its
// source lives within its room: as one answer, or streamed.
const answerQuery = async (args, handed) => {
  const meter = meterFor(Date.now() + REQUEST_MS);
  const checkedQuery = await checked(args.body.query, meter);
  const { source } = checkedQuery;

  if (args.body.check) {
    return { ok: true, source: source.name };
  }

  const reading = { ...args, budget: budgetOf() };

  return withRoom(poolOf(source), () =>
    args.body.stream
      ? streamRead(reading, checkedQuery, meter, handed)
      : readWindows(reading, checkedQuery, meter),
  );
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
// same operator's last one still runs. A stream is handed over as soon as
// its rows are read, its room held until it ends; a check is answered as
// any.
export const exploreQueryUseCase = (args) => {
  const handed = Promise.withResolvers();

  oneOperatorAtATime(args.actorId, () => answerQuery(args, handed))
    .catch(answerOfError(null, NO_QUERY))
    .then((answered) => answered && handed.resolve(answered))
    .catch((error) => handed.reject(error));

  return withVocabulary(handed.promise, vocabularyFor());
};
