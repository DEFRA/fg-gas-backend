import Boom from "@hapi/boom";
import { logger } from "../../common/logger.js";

// The failure policy the composed admin pages share. GAS is the backend for
// the admin frontend, so a page arrives as one read; a section of it that
// could not be read arrives as a null beside a named reason, and never as a
// lost page.
//
// The section vocabulary lives here rather than in either composite, so
// "counts", "breakdown" and "journey" all degrade and report the same way.

const SECTION_READ_FAILED = "read failed";

// A fixed, payload-free vocabulary, exactly as a sourceError has. A Boom
// carries a message somebody wrote for the operator ("Events could not be
// loaded from GAS"), and Boom masks a 500's own message behind the generic
// internal-error text; anything that is not a Boom - a driver error, say -
// contributes the one-liner rather than its own message, so nothing a database
// said reaches the page.
export const describeSectionFailure = (error) =>
  Boom.isBoom(error) ? error.output.payload.message : SECTION_READ_FAILED;

// A section that answered contributes its answer; one that did not contributes
// a null and names itself in `sectionErrors`. Nothing degrades quietly.
export const sectionOf = (section, settled, sectionErrors) => {
  if (settled.status === "fulfilled") {
    return settled.value;
  }

  logger.error(settled.reason, `Admin page: ${section} could not be read`);

  sectionErrors.push({
    section,
    message: describeSectionFailure(settled.reason),
  });

  return null;
};
