import { logger } from "../../common/logger.js";
import { applicationExists } from "../../grants/services/application-read.service.js";
import {
  describeError,
  findCwCase,
} from "../repositories/cw-actuators.repository.js";

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

    return { counterpart: { exists }, accounts: identifiers };
  } catch (error) {
    logger.warn(
      `Case page: application link unknown (${describeError(error)})`,
    );

    return { counterpart: null };
  }
};

export const readCaseHeader = async (args) => {
  const [{ summary }, link] = await Promise.all([
    args.caseRead,
    readApplicationLink(args),
  ]);

  return {
    header: {
      caseRef: summary.caseRef,
      workflowCode: summary.workflowCode,
      position: summary.position,
      closed: summary.closed,
      closedAt: summary.closedAt,
      counterpart: link.counterpart,
      fetchedAt: new Date().toISOString(),
    },
    accounts: link.accounts,
  };
};
