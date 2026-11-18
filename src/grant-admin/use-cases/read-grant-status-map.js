import { logger } from "../../common/logger.js";
import { GRANT_VERSION_NOT_FOUND } from "../services/grant-not-found.js";
import { describeReason } from "../services/page-sections.js";
import { viewGrantVersionPageUseCase } from "./view-grant-version-page.use-case.js";

// GAS's spelling of a grant code: a workflow code with capitals has no grant.
const GRANT_CODE = /^[a-z0-9-]+$/;

const NO_GRANT = { outcome: "no-grant" };
const UNAVAILABLE = { outcome: "unavailable" };

const hasPhases = ({ lifecycle, sectionErrors }) =>
  lifecycle !== null &&
  !sectionErrors.some(({ section }) => section === "phases");

const fromPage = (page) => {
  if (!page.header.files.grant.stored) {
    return { outcome: "not-stored" };
  }

  if (page.problem !== null) {
    return { outcome: "unreadable" };
  }

  return hasPhases(page)
    ? { outcome: "found", lifecycle: page.lifecycle }
    : UNAVAILABLE;
};

const isGrantNotFound = (error) =>
  error.output?.payload?.reason === GRANT_VERSION_NOT_FOUND;

// What GAS does with the statuses a workflow sends, as the grant of the same
// code and version says: read as its own Phases tab, and audited as one.
export const readGrantStatusMap = async ({ code, version, caller }) => {
  if (!GRANT_CODE.test(code)) {
    return NO_GRANT;
  }

  try {
    return fromPage(
      await viewGrantVersionPageUseCase({
        code,
        version,
        tab: "phases",
        caller,
      }),
    );
  } catch (error) {
    if (isGrantNotFound(error)) {
      return NO_GRANT;
    }

    logger.warn(
      `Workflow version phases: grant lifecycle unread (${describeReason(error)})`,
    );

    return UNAVAILABLE;
  }
};
