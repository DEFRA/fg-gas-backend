import { logger } from "../../common/logger.js";
import {
  ADMIN_READ_SECURITY,
  auditActions,
  auditEntities,
} from "../../events/audit-constants.js";
import { buildAuditEvent } from "../../events/with-audit.js";
import { readCaseHeader, startCaseRead } from "../services/case-page.js";
import { viewRecordPage } from "../services/record-page.js";
import { readRecordEventsUseCase } from "./read-record-events.use-case.js";

const readOverview = async ({ caseRead }) => {
  const { case: summary, storedBytes } = await caseRead;

  return {
    content: {
      overview: {
        workflowCode: summary.ref.workflowCode,
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

const readEvents = ({ caseRef }) => readRecordEventsUseCase(caseRef);

// Caseworking leaves its notes out of the document; nothing here adds them.
const readRaw = async ({ caseRead }) => {
  const { document, storedBytes } = await caseRead;

  logger.info(`Read case document: ${storedBytes} bytes`);

  return { content: { raw: document ?? null, storedBytes } };
};

export const CASE_TABS = {
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
    security: ADMIN_READ_SECURITY,
    segregationRef: "admin-view-case",
  });

const viewCasePage = viewRecordPage({
  readHeader: readCaseHeader,
  tabs: CASE_TABS,
  audit: buildViewCaseAudit,
});

export const viewCasePageUseCase = ({
  workflowCode,
  caseRef,
  tab,
  caller,
  actor,
}) => {
  logger.info(`View case ${tab}`);

  const caseRead = startCaseRead(
    { workflowCode, caseRef },
    { actor, document: CASE_TABS[tab].include === "document" },
  );

  return viewCasePage({ workflowCode, caseRef, tab, caller, caseRead });
};
