import Boom from "@hapi/boom";
import { checkPart } from "../../common/explore/large-answers.js";
import { parsePath } from "../../common/explore/paths.js";
import { SIZE_ERROR } from "../../common/explore/evaluate.js";
import { START_BYTES } from "../../common/explore/document-start.js";
import {
  CELLS_HELD_BYTES,
  DOCUMENTS_MODE,
  MAX_DOCUMENT_BYTES,
  MAX_LIMIT,
  STARTS,
  sourcesSchema,
} from "../../common/explore/query-schema.js";
import { RESIDUAL_REASONS } from "../../common/explore/index-tests.js";
import { REFUSALS, refuseQuery } from "../../common/explore/refusal.js";
import { bodyOf, cwRequest, operatorHeaders } from "./cw-http.js";

const BAD_REQUEST = 400;
const TOO_MANY_REQUESTS = 429;
const EXPLORE_LABEL = "explore";
export const QUERY_INVALID = "EXPLORE_QUERY_INVALID";

const cwFailure = (reason) => {
  const error = Boom.badGateway(`CW-BE explore failed: ${reason}`);

  error.output.payload = { ...error.output.payload, hop: "CW-BE", reason };

  return error;
};

// Why Caseworking's read couldn't be exact, where it says and GAS knows it,
// and at which path; or what it had too many of, in plain words.
const pathOf = (path) => (parsePath(path) ? path : null);

const NOUN = /^[a-z][a-z ]{0,63}$/;

const nounOf = (noun) =>
  typeof noun === "string" && NOUN.test(noun) ? noun : null;

// mongod's type names, as its messages give them.
const BSON_TYPE = /^[a-zA-Z]{1,24}$/;

const MAX_COLUMN = 20;

const columnOf = (column) =>
  Number.isInteger(column) && column >= 0 && column < MAX_COLUMN
    ? column
    : null;

// Where mongod failed on a value: the type it names and the column, never
// a value.
const mongodDetailOf = ({ fn, type, column }) =>
  fn === "count" && BSON_TYPE.test(type ?? "")
    ? { fn, type, column: columnOf(column) }
    : null;

const residualDetailOf = ({ why, path, noun }) => {
  if (RESIDUAL_REASONS.includes(why)) {
    return { why, path: pathOf(path) };
  }

  return nounOf(noun) ? { why: null, path: null, noun } : null;
};

const detailOf = (detail, refusal) =>
  refusal === SIZE_ERROR
    ? mongodDetailOf(detail ?? {})
    : residualDetailOf(detail ?? {});

const byCw = (error) => Object.assign(error, { service: "CW" });

// Only the refusal's code, and its detail, are read from Caseworking's
// answer; GAS words the message itself.
const refused = (error) => {
  const { reason, refusal, detail } = bodyOf(error) ?? {};

  if (reason === QUERY_INVALID) {
    return cwFailure(QUERY_INVALID);
  }

  return REFUSALS.includes(refusal)
    ? byCw(refuseQuery(refusal, detailOf(detail, refusal)))
    : cwFailure("ERRORED");
};

const BUSY = ["BUSY", "FULL"];

// Busy with this operator's last query, or with as many as Caseworking runs.
const busyOf = (error) => {
  const { refusal } = bodyOf(error) ?? {};

  return BUSY.includes(refusal) ? refusal : "BUSY";
};

const EXPLORE_FAILURES = {
  [BAD_REQUEST]: refused,
  [TOO_MANY_REQUESTS]: (error) => byCw(refuseQuery(busyOf(error))),
  otherwise: () => new Error("CW-BE explore failed"),
};

// A failure with no answer of Caseworking's own says why it gave none.
const isAnswered = (error) =>
  Boolean(error.refusal) || Boolean(error.output?.payload.hop);

const asCwFailure = (error) => {
  throw isAnswered(error) ? error : cwFailure(error.cwReason ?? "ERRORED");
};

const readOrFail = (schema, payload) => {
  const { error, value } = schema.validate(payload, { allowUnknown: true });

  if (error) {
    throw cwFailure("ERRORED");
  }

  return value;
};

// What Caseworking can be asked: its sources.
export const findCwExploreSources = () =>
  cwRequest("get", "/actuators/explore/sources", EXPLORE_LABEL, {
    failures: EXPLORE_FAILURES,
  })
    .catch(asCwFailure)
    .then((payload) => readOrFail(sourcesSchema, payload));

// Caseworking's part of a query, which it audits itself. It reads for the
// time GAS has left, less a margin for the answer to come back.
const TIME_LEFT_HEADER = "x-explore-time-left-ms";
const MARGIN_MS = 500;

// The most an answer of Caseworking's holds: the cells it may hold (a
// page's, or a download's own), or the documents and joined records, in
// base64, it may hold, or one row's of a document and its joined record
// past them, or a start for each row asked; and what each row takes beside
// them, for two boxes' windows.
// On the seed a row takes at most 231 bytes beside its cells
// (verify/explore-measure.js).
const ROW_BYTES = 1024;
const ROWS = 2 * MAX_LIMIT;
const ONE_ROW_BYTES = 2 * MAX_DOCUMENT_BYTES;

const BASE64_BYTES = 3;
const BASE64_CHARACTERS = 4;

const base64Bytes = (bytes) =>
  Math.ceil(bytes / BASE64_BYTES) * BASE64_CHARACTERS;

const fetchedBytesOf = (query) =>
  query.documents.mode === STARTS
    ? query.rows.length * base64Bytes(START_BYTES)
    : base64Bytes(Math.max(query.documents.bytes, ONE_ROW_BYTES));

export const maxBytesOf = (query) =>
  ROWS * ROW_BYTES +
  (query.mode === DOCUMENTS_MODE
    ? fetchedBytesOf(query)
    : (query.cellBytes ?? CELLS_HELD_BYTES));

const tooLargeAnswer = () => byCw(refuseQuery("ANSWER_TOO_LARGE"));

export const queryCwExplore = (query, { actor, timeLeftMs, signal }) => {
  if (timeLeftMs <= MARGIN_MS) {
    return Promise.reject(byCw(refuseQuery("TOO_SLOW")));
  }

  return cwRequest("post", "/actuators/explore/query", EXPLORE_LABEL, {
    body: query,
    maxBytes: maxBytesOf(query),
    failures: { ...EXPLORE_FAILURES, tooLarge: tooLargeAnswer },
    timeout: timeLeftMs,
    signal,
    headers: {
      ...operatorHeaders({ actor }),
      [TIME_LEFT_HEADER]: String(timeLeftMs - MARGIN_MS),
    },
  })
    .catch(asCwFailure)
    .then((payload) =>
      checkPart(payload, {
        allowUnknown: true,
        query,
      }).catch(() => {
        throw cwFailure("ERRORED");
      }),
    );
};

export const cwExploreFailure = cwFailure;
