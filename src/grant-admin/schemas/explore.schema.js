import Joi from "joi";
import { checkEach, hasCells } from "../../common/explore/large-answers.js";
import { isIdText } from "../../common/explore/bson-bytes.js";
import {
  MAX_DOCUMENT_BYTES,
  MAX_LIMIT,
  MAX_UNWINDS,
  MODES,
  TYPES,
  idText,
} from "../../common/explore/query-schema.js";
import { STOPPED } from "../explore/csv.js";
import { MAX_WINDOWS } from "../explore/windows.js";
import { adminReadHeadersSchema } from "./actor-header.schema.js";

// A little over the 4,000 characters a query may be, so the parser refuses
// one just over with where it went over.
const MAX_QUERY_TEXT = 4_100;

export const exploreHeadersSchema =
  adminReadHeadersSchema.label("ExploreHeaders");

const MAX_POSITIONS = 4_000;

const isIdOnlyText = (id, helpers) =>
  isIdText(id, MAX_DOCUMENT_BYTES) ? id : helpers.error("any.invalid");

export const exploreQueryRequestSchema = Joi.object({
  query: Joi.string().max(MAX_QUERY_TEXT).allow("").required(),
  positions: Joi.string().max(MAX_POSITIONS).allow(null),
  limit: Joi.number().integer().min(1).max(MAX_LIMIT),
  csv: Joi.boolean(),
  // With csv: read down to the end, not to `positions`, within the deadline
  // (partial when cut short).
  untilEnd: Joi.boolean(),
  check: Joi.boolean(),
  // Accepted with no effect: every answer, and refusal, carries the editor's
  // vocabulary.
  vocabulary: Joi.boolean(),
  // Windows 1 to N read in turn, from `positions` or the top, as one answer.
  windows: Joi.number().integer().min(1).max(MAX_WINDOWS),
  // Each row's document as stored: for Show it, and for Download JSON.
  documents: Joi.boolean().when("show", {
    is: Joi.exist(),
    otherwise: Joi.when("stream", { is: true, otherwise: Joi.valid(false) }),
  }),
  // Each record row's start (document-start.js), for a page or windows.
  starts: Joi.boolean(),
  // Show it: the run's row whose record has this `_id` (the base64 BSON of
  // { _id }), at these unwind positions, and for an event this service and
  // box, read again by the run's query.
  show: Joi.object({
    id: idText.required().custom(isIdOnlyText),
    at: Joi.array()
      .items(Joi.number().integer().min(0).allow(null))
      .max(MAX_UNWINDS)
      .required(),
    service: Joi.string().valid("GAS", "CW").allow(null).required(),
    box: Joi.string().valid("outbox", "inbox").allow(null).required(),
  }),
  // With csv and documents: the download streamed as NDJSON.
  stream: Joi.boolean().when("csv", {
    is: true,
    then: Joi.when("documents", {
      is: true,
      otherwise: Joi.valid(false),
    }),
    otherwise: Joi.valid(false),
  }),
})
  .oxor("csv", "windows")
  .without("show", ["positions", "untilEnd"])
  .when(Joi.object({ starts: Joi.valid(true).required() }).unknown(), {
    then: Joi.object({
      documents: Joi.valid(false),
      csv: Joi.valid(false),
      stream: Joi.valid(false),
      show: Joi.forbidden(),
    }),
  })
  .label("ExploreQueryRequest");

const KINDS = ["text", "number", "date"];

export const exploreVocabularyResponseSchema = Joi.object({
  sources: Joi.array()
    .items(
      Joi.object({
        name: Joi.string().required(),
        label: Joi.string().required(),
        time: Joi.string().allow(null).required(),
        paths: Joi.array()
          .items(
            Joi.object({
              path: Joi.string().required(),
              type: Joi.string().valid(...TYPES),
              indexed: Joi.boolean().required(),
              values: Joi.array().items(
                Joi.object({
                  value: Joi.string().required(),
                  label: Joi.string().required(),
                }),
              ),
            }),
          )
          .required(),
      }),
    )
    .required(),
}).label("ExploreVocabularyResponse");

const vocabularySchema = exploreVocabularyResponseSchema.allow(null);

const skippedSchema = Joi.object({
  open: Joi.object().unknown(true).allow(null).required(),
  id: Joi.string().required(),
});

const countSchema = Joi.object({
  n: Joi.number().integer().min(0).required(),
  capped: Joi.boolean().required(),
  groups: Joi.number().integer().min(0),
});

const answerSchema = Joi.object({
  source: Joi.object({
    name: Joi.string().required(),
    noun: Joi.string().required(),
  }).required(),
  mode: Joi.string()
    .valid(...MODES)
    .required(),
  read: Joi.string().valid("exact", "windowed", "full").required(),
  columns: Joi.array()
    .items(
      Joi.object({
        key: Joi.string().required(),
        label: Joi.string().required(),
        kind: Joi.string()
          .valid(...KINDS)
          .required(),
        aggregate: Joi.boolean().required(),
        // The stored path a plain path's column shows, else null.
        path: Joi.string().allow(null).required(),
      }),
    )
    .required(),
  // Checked by hand (isAnswerRow): with documents, each row also carries
  // `id`, `at` (its unwind positions), `doc`, `context` and `docNote`; with
  // starts, a record's row `start` and `printed` in place of `doc`, and a
  // group's, value's or count's `start` beside its `doc`; with show, the
  // record's `start` beside its `doc`.
  rows: Joi.array().required(),
  count: countSchema.allow(null).required(),
  groups: Joi.boolean().required(),
  // Rows are what $unwind made of the records: the count counts them.
  unwound: Joi.boolean().required(),
  // Paths the query reads that no definition names, which may be mistyped.
  unseen: Joi.array().items(Joi.string()).required(),
  // The read ran out of work and ended its window early: the rows are those
  // found back to window.to, and Keep looking goes on from there.
  partial: Joi.boolean().required(),
  window: Joi.object({
    to: Joi.string().isoDate().allow(null).required(),
    end: Joi.boolean().required(),
    positions: Joi.string().allow(null).required(),
    // Records in the window too large to search, skipped: what each opens
    // and its typed `_id`.
    skipped: Joi.array().items(skippedSchema).required(),
  })
    .allow(null)
    .required(),
  // With documents or starts: whether they are whole records, and the
  // bytes of the documents or starts sent.
  documents: Joi.object({
    whole: Joi.boolean().required(),
    bytes: Joi.number().integer().min(0).required(),
    // With show: whether the record shown is gone.
    gone: Joi.boolean(),
  }).allow(null),
  // The most rows one answer holds for these columns, and how they are
  // raised: `.limit(n)`, a `$limit` stage, or not at all.
  limits: Joi.object({
    rows: Joi.number().integer().min(1).max(MAX_LIMIT).required(),
    raise: Joi.string().valid("limit", "stage").allow(null).required(),
  }),
  // A CSV's own limit, and where and why it stopped short.
  download: Joi.object({
    rows: Joi.number().integer().min(1).max(MAX_LIMIT).required(),
    stopped: Joi.string()
      .valid(...Object.values(STOPPED))
      .allow(null)
      .required(),
    searchedTo: Joi.string().isoDate().allow(null).required(),
  }).allow(null),
  // With `windows`: the rows each window read, and why they end before the
  // last asked: the window that failed after them, whose rows are left out,
  // 413 TOO_MANY_CELLS when the next would not fit in one answer, or 408
  // QUERY_TOO_SLOW when too little time was left for it; neither was read.
  windowRows: Joi.array().items(Joi.number().integer().min(0)),
  stopped: Joi.object({
    statusCode: Joi.number().integer().required(),
    code: Joi.string().required(),
  }).allow(null),
  vocabulary: vocabularySchema,
});

const checkedSchema = Joi.object({
  ok: Joi.boolean().valid(true).required(),
  source: Joi.string().required(),
  vocabulary: vocabularySchema,
});

const isPlain = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const ROW_KEYS = new Set([
  "open",
  "cells",
  "id",
  "at",
  "doc",
  "start",
  "printed",
  "context",
  "docNote",
]);

const isTextOrNull = (value) => value === null || typeof value === "string";

const isPlainOrNull = (value) => value === null || isPlain(value);

const isPositions = (value) =>
  Array.isArray(value) &&
  value.length <= MAX_UNWINDS &&
  value.every((n) => n === null || (Number.isInteger(n) && n >= 0));

// A row with documents carries all four of their keys, and a note says
// why it has no document.
const hasDocumentKeys = (row) =>
  !Object.hasOwn(row, "doc") ||
  [
    isTextOrNull(row.id),
    row.at === null || isPositions(row.at),
    isTextOrNull(row.doc),
    isPlainOrNull(row.context),
    isPlainOrNull(row.docNote),
    row.doc !== null || row.docNote !== null,
  ].every(Boolean);

const isStartOf = (start) =>
  [
    typeof start.doc === "string",
    typeof start.cut === "boolean",
    [undefined, true].includes(start.quotedKey),
  ].every(Boolean);

const isStart = (start) => isPlain(start) && isStartOf(start);

const isCount = (n) => Number.isInteger(n) && n >= 0;

const isPrinted = (printed) =>
  isPlain(printed) && isCount(printed.bytes) && isCount(printed.values);

// A record's row with starts carries its start and what its document
// printed whole, or a note saying why it has neither.
const isStartedOrNoted = ({ start, printed, docNote }) =>
  start === null
    ? printed === null && docNote !== null
    : isStart(start) && isPrinted(printed);

const isStartRow = (row) =>
  [
    typeof row.id === "string",
    isPositions(row.at),
    isStartedOrNoted(row),
    isPlainOrNull(row.context),
    isPlainOrNull(row.docNote),
    !Object.hasOwn(row, "doc"),
  ].every(Boolean);

// Beside a document (Show it's record, a group, a value or a count), its
// start, or null for a record with no document.
const isDocumentStart = (row) =>
  (row.start === null ? row.doc === null : isStart(row.start)) &&
  !Object.hasOwn(row, "printed");

const isStartOfRow = (row) =>
  Object.hasOwn(row, "doc") ? isDocumentStart(row) : isStartRow(row);

const hasStartKeys = (row) => !Object.hasOwn(row, "start") || isStartOfRow(row);

const isRowOf = (row) =>
  [
    Object.keys(row).every((key) => ROW_KEYS.has(key)),
    isPlainOrNull(row.open),
    hasCells(row.cells),
    hasDocumentKeys(row),
    hasStartKeys(row),
  ].every(Boolean);

const isAnswerRow = (row) => isPlain(row) && isRowOf(row);

const throwing = ({ error, value }) => {
  if (error) {
    throw error;
  }

  return value;
};

const checkAnswer = async (answer) => {
  const value = throwing(answerSchema.validate({ ...answer, rows: [] }));

  await checkEach(answer.rows, isAnswerRow, ["rows"]);

  return { ...value, rows: answer.rows };
};

// An answer's shape as Joi checks it, its rows by hand, so thousands of rows
// never hold the event loop.
export const exploreQueryResponseSchema = (value) =>
  isPlain(value) && value.ok
    ? throwing(checkedSchema.validate(value))
    : checkAnswer(value);
