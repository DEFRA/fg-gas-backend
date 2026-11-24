import { logger } from "../../common/logger.js";
import {
  PMC_0706_SECURITY,
  auditActions,
  auditEntities,
} from "../../events/audit-constants.js";
import { auditedRead } from "../../events/audited-read.js";
import { buildAuditEvent } from "../../events/with-audit.js";
import { composeRecordPage } from "../services/compose-record-page.js";
import { rawSectionOf } from "../services/raw-section.js";
import { readCaseHeader, startCaseRead } from "./case-page.helpers.js";
import { readCaseEventsUseCase } from "./read-record-events.use-case.js";

const readOverview = async ({ caseRead }) => {
  const { summary, storedBytes } = await caseRead;

  return {
    content: {
      overview: {
        workflowCode: summary.workflowCode,
        originalConfigVersion: summary.originalConfigVersion,
        currentConfigVersion: summary.currentConfigVersion,
        createdAt: summary.createdAt,
        closed: summary.closed,
        closedAt: summary.closedAt,
        series: summary.series,
        storedBytes,
      },
    },
  };
};

const readEvents = ({ workflowCode, caseRef, actor }) =>
  readCaseEventsUseCase({ workflowCode, caseRef, actor });

// A document over the read limit comes back as its size alone, too large.
const readRaw = async ({ caseRead }) => {
  const { document, storedBytes, tooLarge } = await caseRead;

  logger.info(`Read case document: ${storedBytes} bytes`);

  return rawSectionOf({ document, storedBytes, tooLarge });
};

const CASE_TABS = {
  overview: { readTab: readOverview, empty: { overview: null } },
  events: { readTab: readEvents, empty: { events: null } },
  raw: {
    readTab: readRaw,
    empty: { document: null, storedBytes: null },
    capped: "document",
    sized: true,
    include: "document",
  },
};

export const buildViewCaseAudit = (
  { workflowCode, caseRef, tab, caller, accounts },
  error,
) =>
  buildAuditEvent({
    entity: auditEntities.CASE,
    action: auditActions.VIEW_CASE_DATA,
    entityid: caseRef,
    details: { caller, workflowCode, tab, ...(error ? {} : accounts) },
    security: PMC_0706_SECURITY,
    segregationRef: "admin-view-case",
  });

const viewCasePage = (args) => {
  const tab = CASE_TABS[args.tab];
  const caseRead = startCaseRead(args, {
    include: tab.include,
    actor: args.actor,
  });

  return composeRecordPage({
    readHeader: readCaseHeader,
    tab,
    args: { ...args, caseRead },
  });
};

const auditedViewCasePage = auditedRead(viewCasePage, (args, result, error) =>
  buildViewCaseAudit({ ...args, accounts: result?.accounts }, error),
);

export const viewCasePageUseCase = async ({
  workflowCode,
  caseRef,
  tab,
  caller,
  actor,
}) => {
  logger.info(`View case ${tab}`);

  const { page } = await auditedViewCasePage({
    workflowCode,
    caseRef,
    tab,
    caller,
    actor,
  });

  return page;
};
