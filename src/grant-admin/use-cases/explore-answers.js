import Boom from "@hapi/boom";
import { SIZE_ERROR, sizeMessage } from "../../common/explore/evaluate.js";
import { TOO_MANY_COMBINATIONS } from "../../common/explore/index-tests.js";
import { refusalOf } from "../../common/explore/refusal.js";
import { narrowingPaths, windowedMessage } from "../explore/check.js";

export const BAD_REQUEST = 400;
const TOO_SLOW = 408;
const TOO_MANY_REQUESTS = 429;

const SERVICES = { GAS: "The Grant Application Service", CW: "Caseworking" };

// The payload is the whole answer; the error's own message names only why.
// Each is an answer to what was asked, logged as one, never as a failure.
export const answerWith = (statusCode, payload, logLevel = "info") => {
  const error = new Boom.Boom(payload.reason, {
    statusCode,
    data: { logLevel },
  });

  error.output.payload = { statusCode, ...payload };

  return error;
};

export const queryInvalid = (error) =>
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
  CELLS_TOO_LARGE: () =>
    "These cells are too large to show together. Name fewer paths or set a lower .limit()",
  ANSWER_TOO_LARGE: () =>
    "This answer is too large: set a lower .limit() or name fewer paths",
};

// mongod's own words where its expression fails, at the expression in the
// query when the column is known.
const MONGOD_MESSAGES = { count: ({ type }) => sizeMessage(type) };

const spanOf = (spans, column) =>
  Number.isInteger(column) && spans ? (spans.columns[column] ?? null) : null;

const mongodError = ({ detail, spans, service }) => {
  const failed = { fn: "count", column: null, ...detail };
  const message = MONGOD_MESSAGES[failed.fn](failed);
  const span = spanOf(spans, failed.column);

  return answerWith(BAD_REQUEST, {
    reason: "QUERY_REFUSED",
    refusal: SIZE_ERROR,
    message,
    service,
    ...(span && { error: { message, at: span.at, end: span.end } }),
  });
};

// Refusals GPA tells apart by their code, beside the message.
const NAMED = new Set(["CELLS_TOO_LARGE", "ANSWER_TOO_LARGE"]);

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

const refused = (code, refusal) => {
  if (code === SIZE_ERROR) {
    return mongodError(refusal);
  }

  return Object.hasOwn(ANSWERS, code)
    ? ANSWERS[code](refusal)
    : answerWith(BAD_REQUEST, {
        reason: "QUERY_REFUSED",
        ...(NAMED.has(code) && { refusal: code }),
        message: REFUSED[code](refusal),
        service: refusal.service,
      });
};

// A refusal answers with the service that refused it, GAS or Caseworking.
export const NO_QUERY = { mode: null, where: null };

export const answerOfError =
  (source, query, spans = null) =>
  (error) => {
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
          spans,
        })
      : error;
  };
