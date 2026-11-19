import Joi from "joi";
import { checkEach, hasCells } from "../../common/explore/large-answers.js";
import { MAX_LIMIT, MODES } from "../../common/explore/query-schema.js";
import { MAX_WINDOWS } from "../explore/windows.js";
import { adminReadHeadersSchema } from "./actor-header.schema.js";

// A little over the 4,000 characters a query may be, so the parser refuses
// one just over with where it went over.
const MAX_QUERY_TEXT = 4_100;
const MAX_ROLES = 2_000;

// The roles GPA's user holds, comma-separated: a source may need one.
const rolesHeader = { "x-actor-roles": Joi.string().max(MAX_ROLES).allow("") };

export const exploreHeadersSchema = adminReadHeadersSchema
  .keys(rolesHeader)
  .label("ExploreHeaders");

export const exploreVocabularyHeadersSchema = Joi.object(rolesHeader)
  .unknown(true)
  .label("ExploreVocabularyHeaders");

const MAX_POSITIONS = 4_000;

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
})
  .oxor("csv", "windows")
  .label("ExploreQueryRequest");

// A cell is a value as stored, a list of cells, or an object as `{ text }`:
// its readable fields inline, without denied names or answers off the answer
// list. The audit records the columns asked for, not what an object showed:
// the deny list fixes what may be read below a column.
const cell = Joi.alternatives(
  Joi.string().allow(""),
  Joi.number(),
  Joi.object({ text: Joi.string().required() }),
  Joi.array().items(Joi.link("#answerCell")),
)
  .allow(null)
  .id("answerCell");

const KINDS = ["text", "number", "date"];
const TYPES = ["text", "number", "boolean", "date"];

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
      }),
    )
    .required(),
  rows: Joi.array()
    .items(
      Joi.object({
        open: Joi.object().unknown(true).allow(null).required(),
        cells: Joi.object().pattern(Joi.string(), cell).required(),
      }),
    )
    .required(),
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
    // Records in the window too large to search, skipped.
    skipped: Joi.number().integer().min(0).required(),
  })
    .allow(null)
    .required(),
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

const isAnswerRow = (row) =>
  isPlain(row) &&
  (row.open === null || isPlain(row.open)) &&
  hasCells(row.cells);

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
