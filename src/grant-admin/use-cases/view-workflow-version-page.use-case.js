import { logger } from "../../common/logger.js";
import {
  PMC_0706_SECURITY,
  auditActions,
  auditEntities,
} from "../../events/audit-constants.js";
import { auditedRead } from "../../events/audited-read.js";
import { buildAuditEvent } from "../../events/with-audit.js";
import { composeRecordPage } from "../services/compose-record-page.js";
import {
  readWorkflowVersionHeader,
  startWorkflowVersionRead,
} from "./workflow-version-page.helpers.js";

const NOT_STORED = { schemeName: null, requiredRoles: null };

const readOverview = async ({ workflowVersionRead }) => {
  const { summary, storedBytes } = await workflowVersionRead;
  const { schemeName, requiredRoles } = summary ?? NOT_STORED;

  return { content: { overview: { schemeName, requiredRoles, storedBytes } } };
};

const readDefinition = async ({ workflowVersionRead }) => {
  const { document, addresses, tooLarge } = await workflowVersionRead;

  return {
    content: { definition: document && { workflow: document, addresses } },
    tooLarge,
  };
};

const readRaw = async ({ workflowVersionRead }) => {
  const { document, storedBytes, tooLarge } = await workflowVersionRead;

  logger.info(`Read workflow document: ${storedBytes} bytes`);

  return { content: { raw: document, storedBytes }, tooLarge };
};

const WORKFLOW_VERSION_TABS = {
  overview: {
    readTab: readOverview,
    empty: { overview: null },
    withCounterpart: true,
  },
  definition: {
    readTab: readDefinition,
    empty: { definition: null },
    capped: "definition",
    include: "document",
  },
  raw: {
    readTab: readRaw,
    empty: { raw: null, storedBytes: null },
    capped: "raw",
    include: "document",
  },
};

export const buildViewWorkflowVersionAudit = ({ code, version, tab, caller }) =>
  buildAuditEvent({
    entity: auditEntities.WORKFLOW,
    action: auditActions.VIEW_WORKFLOW_VERSION,
    entityid: code,
    details: { caller, version, tab },
    security: PMC_0706_SECURITY,
    segregationRef: "admin-view-workflow-version",
  });

const viewWorkflowVersionPage = (args) => {
  const tab = WORKFLOW_VERSION_TABS[args.tab];
  const workflowVersionRead = startWorkflowVersionRead(args, {
    include: tab.include,
    actor: args.actor,
  });

  return composeRecordPage({
    readHeader: readWorkflowVersionHeader,
    tab,
    args: {
      ...args,
      workflowVersionRead,
      withCounterpart: Boolean(tab.withCounterpart),
    },
  });
};

const auditedViewWorkflowVersionPage = auditedRead(
  viewWorkflowVersionPage,
  buildViewWorkflowVersionAudit,
);

export const viewWorkflowVersionPageUseCase = async ({
  code,
  version,
  tab,
  caller,
  actor,
}) => {
  logger.info(`View workflow version ${tab}`);

  const { page } = await auditedViewWorkflowVersionPage({
    code,
    version,
    tab,
    caller,
    actor,
  });

  return page;
};
