import Boom from "@hapi/boom";
import { logger } from "../../common/logger.js";

// A failed section arrives as null beside a named reason, never as a lost page.

const SECTION_READ_FAILED = "read failed";

// Only Boom messages reach the page; anything else could leak a database error.
export const describeSectionFailure = (error) =>
  Boom.isBoom(error) ? error.output.payload.message : SECTION_READ_FAILED;

// Never the reason itself: a Caseworking error carries its response body.
export const describeReason = (reason) =>
  Boom.isBoom(reason) ? reason.output.statusCode : (reason?.name ?? "unknown");

export const sectionOf = (section, settled, sectionErrors) => {
  if (settled.status === "fulfilled") {
    return settled.value;
  }

  logger.error(
    `Admin page: ${section} could not be read (${describeReason(settled.reason)})`,
  );

  sectionErrors.push({
    section,
    message: describeSectionFailure(settled.reason),
  });

  return null;
};
