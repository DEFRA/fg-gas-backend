import Joi from "joi";

// What a value in a banner may be. A lone "$." reference resolves to the value
// it points at; anything richer - a concatenation, a conditional - says so with
// the "jsonata:" prefix; anything else is the literal text itself, which is how
// a scheme name that never varies is written. Resolution is resolveRefs in the
// agreements module, which already reads all three.
const text = Joi.string().allow("");

// Constrained so a typo is caught when the definition is written rather than
// when a page renders. Mirrors the case working banner config, so a grant
// carrying both keeps one vocabulary.
const type = Joi.string().valid("string", "number", "boolean", "date");

const summaryEntry = Joi.object({
  label: Joi.string().required(),
  text: text.required(),
  type: type.required(),
  // Names a view filter, e.g. "formatDate". The renderer owns what each does.
  format: Joi.string().optional(),
}).label("PageBannerSummaryEntry");

// The heading the page is titled with, over labelled fields beneath it. Key
// order is the order they are shown in, so a definition decides the reading
// order without the page hard coding one.
const banner = Joi.object({
  title: Joi.object({
    text: text.required(),
    type: type.required(),
  })
    .required()
    .label("PageBannerTitle"),
  summary: Joi.object()
    .pattern(Joi.string(), summaryEntry)
    .min(1)
    .optional()
    .label("PageBannerSummary"),
}).label("PageBanner");

const pageName = Joi.string().pattern(/^[a-z0-9-]+$/);

// Keyed by page - "claims" today, with the other tabs of an application to
// come - so a page is added to a definition without a schema change here.
export const pages = Joi.object()
  .pattern(
    pageName,
    Joi.object({
      details: Joi.object({
        banner: banner.required(),
      })
        .required()
        .label("PageDetails"),
    }).label("Page"),
  )
  .min(1)
  .label("Pages");
