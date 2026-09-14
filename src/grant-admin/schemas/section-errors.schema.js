import Joi from "joi";

// A section of a composed admin page that could not be read at all. `message`
// is a fixed one-liner in the same spirit as a sourceError's - a deliberate
// sentence or the generic internal-error text - and never a database message
// or a response body. See services/page-sections.js for where it comes from.
//
// Each page names its own sections, so a body can only ever report a section
// it actually has; the shape is identical across pages, so a caller reads them
// all the same way.
export const sectionErrorsSchema = (sections, label) =>
  Joi.array().items(
    Joi.object({
      section: Joi.string()
        .valid(...sections)
        .required(),
      message: Joi.string().required().example("Events could not be loaded"),
    }).label(label),
  );
