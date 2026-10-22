import Joi from "joi";

export const PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
export const MAX_GROUPINGS = 3;
const MAX_VALUE_LENGTH = 200;

const emptyQuery = () => ({
  where: {},
  show: [],
  limit: PAGE_SIZE,
  groupBy: [],
});

const value = Joi.string().min(1).max(MAX_VALUE_LENGTH);

export const queryRequestSchema = Joi.object({
  where: Joi.object().pattern(Joi.string().max(100), value).max(8).default({}),
  show: Joi.array().items(Joi.string().max(100)).max(8).default([]),
  ref: Joi.string().max(256),
  from: Joi.string().isoDate(),
  to: Joi.string().isoDate(),
  cursor: Joi.string().max(512),
  limit: Joi.number().integer().min(1).max(MAX_PAGE_SIZE).default(PAGE_SIZE),
  groupBy: Joi.array()
    .items(Joi.string().max(100))
    .max(MAX_GROUPINGS)
    .default([]),
})
  .empty(null)
  .default(emptyQuery);

const names = Joi.array().items(Joi.string()).required();

const storedValue = Joi.string().allow("");

const nullableString = Joi.string().allow(null, "").required();

const count = {
  count: Joi.number().integer().min(0).required(),
  capped: Joi.boolean().required(),
};

const row = Joi.object({
  id: Joi.string().required(),
  time: Joi.string().isoDate().required(),
  title: nullableString,
  subtitle: nullableString,
  cells: Joi.object().unknown(true).required(),
  link: Joi.object({ kind: Joi.string().required() })
    .unknown(true)
    .allow(null)
    .required(),
});

const group = Joi.object({
  by: Joi.string().required(),
  values: Joi.array()
    .items(Joi.object({ value: storedValue.required(), ...count }))
    .allow(null)
    .required(),
  total: Joi.object(count).allow(null).required(),
});

export const queryResponseSchema = Joi.object({
  bucket: Joi.string().required(),
  plan: Joi.object({
    kind: Joi.string().valid("exact", "bounded").required(),
    index: names,
    bound: names,
    filled: names,
    residual: names,
    scans: Joi.number().integer().min(1).required(),
  }).required(),
  rows: Joi.array().items(row).required(),
  page: Joi.object({
    next: Joi.string().allow(null).required(),
    keepLooking: Joi.string().allow(null).required(),
    searchedTo: Joi.string().isoDate().allow(null).required(),
    complete: Joi.boolean().required(),
  }).required(),
  groups: Joi.array().items(group).required(),
});

export const TIMELINE_LIMIT = 50;

// A link spells out every character of its parts that is not a lower-case
// letter, digit or "-" (up to eight characters each), so it may run far longer
// than a searched identifier.
const MAX_LINK_LENGTH = 4096;

export const timelineRequestSchema = Joi.object({
  ref: Joi.string().max(MAX_LINK_LENGTH).required(),
});

// One entry per timeline bucket; `rows` is null for one that could not be read.
export const timelineResponseSchema = Joi.object({
  buckets: Joi.array()
    .items(
      Joi.object({
        id: Joi.string().required(),
        label: Joi.string().required(),
        rows: Joi.array().items(row).allow(null).required(),
        more: Joi.boolean().required(),
      }),
    )
    .required(),
});

export const summaryRequestSchema = Joi.object({
  show: Joi.array().items(Joi.string().max(100)).max(8).default([]),
  from: Joi.string().isoDate(),
  to: Joi.string().isoDate(),
})
  .empty(null)
  .default(() => ({ show: [] }));

// `value` is null for the rows that hold none; `complete` is false when there
// were more distinct values than are counted; `more` when entries were left off.
export const summaryResponseSchema = Joi.object({
  bucket: Joi.string().required(),
  summary: Joi.string().required(),
  entries: Joi.array()
    .items(
      Joi.object({
        // One value per `by` fact, null for the rows that hold none.
        values: Joi.object()
          .pattern(Joi.string(), storedValue.allow(null))
          .required(),
        ...count,
        firstAt: Joi.string().isoDate().allow(null).required(),
        lastAt: Joi.string().isoDate().allow(null).required(),
      }),
    )
    .required(),
  more: Joi.boolean().required(),
  complete: Joi.boolean().required(),
});

const summary = Joi.object({
  id: Joi.string().required(),
  label: Joi.string().required(),
  by: Joi.array().items(Joi.string()).min(1).required(),
  among: Joi.object().pattern(Joi.string(), Joi.string()).required(),
  top: Joi.number().integer().min(1).required(),
  none: Joi.string().required(),
});

const factValue = Joi.object({
  value: storedValue.required(),
  label: Joi.string().allow("").required(),
  tone: Joi.string().valid("neutral", "info", "warning", "success", "error"),
  hint: Joi.string(),
  hidden: Joi.boolean(),
});

// `param` and `toggle.param` are the keys the admin's URLs carry them under.
const fact = Joi.object({
  name: Joi.string().required(),
  param: Joi.string().required(),
  label: Joi.string().required(),
  values: Joi.array().items(factValue).allow(null).required(),
  toggle: Joi.object({
    label: Joi.string().required(),
    param: Joi.string().required(),
  })
    .allow(null)
    .required(),
  // Optional, so a catalogue from a release before `within` still reads.
  within: Joi.string().allow(null),
});

const column = Joi.object({
  key: Joi.string().required(),
  label: Joi.string().required(),
  format: Joi.string().required(),
  fact: Joi.string(),
});

export const catalogueEntrySchema = Joi.object({
  id: Joi.string().required(),
  path: Joi.string().required(),
  label: Joi.string().required(),
  service: Joi.string().required(),
  shortLabel: Joi.string().required(),
  icon: Joi.string().allow(null).required(),
  order: Joi.number().required(),
  noun: Joi.object({
    one: Joi.string().required(),
    many: Joi.string().required(),
  }).required(),
  time: Joi.object({ label: Joi.string().required() }).required(),
  facts: Joi.array().items(fact).required(),
  refs: Joi.array()
    .items(
      Joi.object({
        kind: Joi.string().required(),
        label: Joi.string().required(),
      }),
    )
    .required(),
  indexes: Joi.array().items(Joi.array().items(Joi.string())).required(),
  groupings: names,
  title: Joi.object({
    label: Joi.string().required(),
    format: Joi.string().required(),
  }).required(),
  columns: Joi.array().items(column).required(),
  audited: Joi.boolean().required(),
  timeline: Joi.boolean().required(),
  summaries: Joi.array().items(summary).required(),
  // Buckets of one service that name the same page are drawn as its tabs.
  page: Joi.object({
    id: Joi.string().required(),
    label: Joi.string().required(),
    shortLabel: Joi.string().required(),
  })
    .allow(null)
    .required(),
  tab: Joi.string().allow(null).required(),
});
