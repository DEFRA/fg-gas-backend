import { logger } from "../../common/logger.js";
import {
  PMC_0706_SECURITY,
  auditActions,
  auditEntities,
} from "../../events/audit-constants.js";
import { auditedRead } from "../../events/audited-read.js";
import { buildAuditEvent } from "../../events/with-audit.js";
import { composeRecordPage } from "../services/compose-record-page.js";
import { RECORD_KINDS } from "../services/record-kinds.js";
import { readCaseHeader, startCaseRead } from "./case-page.helpers.js";
import { readRecordEventsUseCase } from "./read-record-events.use-case.js";

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

const readEvents = ({ workflowCode, caseRef }) =>
  readRecordEventsUseCase({
    kind: RECORD_KINDS.CASE,
    code: workflowCode,
    ref: caseRef,
  });

// Caseworking leaves its notes out of the document; nothing here adds them.
const readRaw = async ({ caseRead }) => {
  const { document, storedBytes, tooLarge } = await caseRead;

  logger.info(`Read case document: ${storedBytes} bytes`);

  return { content: { raw: document, storedBytes }, tooLarge };
};

const CASE_TABS = {
  overview: { readTab: readOverview, empty: { overview: null } },
  events: { readTab: readEvents, empty: { events: null } },
  raw: {
    readTab: readRaw,
    empty: { raw: null, storedBytes: null },
    capped: "raw",
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
