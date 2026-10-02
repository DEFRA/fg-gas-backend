import { logger } from "../../common/logger.js";
import { applicationExists } from "../../grants/services/grant-admin.service.js";
import { findCwCase } from "../repositories/cw-actuators.repository.js";
import { GAS_APPLICATIONS_SOURCE } from "./event-sources.js";

// One Caseworking read per page, started before the page's own reads so the
// header and the tab share it. Its failure surfaces through them.
export const startCaseRead = ({ workflowCode, caseRef }, options) => {
  const read = findCwCase({ workflowCode, caseRef }, options);

  read.catch(() => {});

  return read;
};

// The refs are the application's by construction. Its identifiers are the
// audit's accounts, best effort: an orphan case still has a page.
const readApplicationLink = async ({ workflowCode, caseRef }) => {
  try {
    const { exists, identifiers } = await applicationExists({
      clientRef: caseRef,
      code: workflowCode,
    });

    return {
      counterpart: { exists },
      accounts: identifiers,
      sourceErrors: [],
    };
  } catch {
    logger.warn("Case page: application link unknown");

    return { counterpart: null, sourceErrors: [GAS_APPLICATIONS_SOURCE] };
  }
};

export const readCaseHeader = async (args) => {
  const [{ case: summary }, link] = await Promise.all([
    args.caseRead,
    readApplicationLink(args),
  ]);

  return {
    header: {
      caseRef: summary.ref.caseRef,
      workflowCode: summary.ref.workflowCode,
      position: summary.position,
      closed: summary.closed,
      closedAt: summary.closedAt,
      counterpart: link.counterpart,
      fetchedAt: new Date().toISOString(),
    },
    accounts: link.accounts,
    sourceErrors: link.sourceErrors,
  };
};
