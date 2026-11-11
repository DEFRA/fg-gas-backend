import Joi from "joi";
import { parsePath } from "./path.js";

export const EXACT = "exact";
export const PREFIX = "prefix";
export const MAX_FIELDS = 10;
export const RESERVED_KEYS = ["ref", "sbi", "frn", "crn", "agreement"];

const KEY = /^[a-z][A-Za-z0-9]{0,39}$/;
const MAX_LABEL_LENGTH = 60;
const MAX_PATH_LENGTH = 200;
const MAX_SEGMENTS = 10;
const MIN_PARTS = 2;
const MAX_PARTS = 4;

const isUnder = (roots, text) => roots.some((root) => text.startsWith(root));

const fitsSegments = (segments, single) =>
  segments.length <= MAX_SEGMENTS &&
  !(single && segments.some(({ each }) => each));

const isPathUnder = (roots, text, single) => {
  const segments = parsePath(text);

  return (
    segments !== null && isUnder(roots, text) && fitsSegments(segments, single)
  );
};

// A part of a joined value gives at most one value, so it has no `[*]`.
const pathUnder = (roots, { single }) =>
  Joi.string()
    .max(MAX_PATH_LENGTH)
    .custom((text, helpers) =>
      isPathUnder(roots, text, single) ? text : helpers.error("any.invalid"),
    );

// `roots` are the prefixes a path may start with, such as "$.answers.".
export const searchDeclaration = (roots) =>
  Joi.object({
    fields: Joi.array()
      .items(
        Joi.object({
          key: Joi.string()
            .pattern(KEY)
            .invalid(...RESERVED_KEYS)
            .required(),
          label: Joi.string().min(1).max(MAX_LABEL_LENGTH).required(),
          path: Joi.alternatives(
            pathUnder(roots, { single: false }),
            Joi.array()
              .items(pathUnder(roots, { single: true }))
              .min(MIN_PARTS)
              .max(MAX_PARTS),
          ).required(),
          match: Joi.string().valid(EXACT, PREFIX).default(EXACT),
        }),
      )
      .min(1)
      .max(MAX_FIELDS)
      .unique("key")
      .required(),
  }).label("Search");

// A stored declaration was checked when it was published; absent is none.
export const fieldsOf = (search) =>
  (search?.fields ?? []).map(({ key, label, path, match = EXACT }) => ({
    key,
    label,
    path,
    match,
  }));
