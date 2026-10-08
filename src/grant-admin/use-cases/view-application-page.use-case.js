import { logger } from "../../common/logger.js";
import {
  PMC_0706_SECURITY,
  auditActions,
  auditEntities,
} from "../../events/audit-constants.js";
import { auditedRead } from "../../events/audited-read.js";
import { withJsonNumbers } from "../../events/plain-json.js";
import { buildAuditEvent } from "../../events/with-audit.js";
import {
  findApplicationDocument,
  findApplicationSeries,
} from "../../grants/services/application-read.service.js";
import { orNotFound } from "../services/application-not-found.js";
import {
  SECTION_CAP_BYTES,
  composeRecordPage,
} from "../services/compose-record-page.js";
import { RECORD_KINDS } from "../services/record-kinds.js";
import {
  readApplicationHeader,
  readApplicationSummary,
} from "./application-page.helpers.js";
import { readRecordEventsUseCase } from "./read-record-events.use-case.js";

const readOverview = async ({ clientRef, code }) => {
  const [{ summary, storedBytes }, series] = await Promise.all([
    readApplicationSummary({ clientRef, code }),
    findApplicationSeries({ clientRef, code }),
  ]);

  return {
    content: {
      overview: {
        code: summary.code,
        originalConfigVersion: summary.originalConfigVersion,
        currentConfigVersion: summary.currentConfigVersion,
        submittedAt: summary.submittedAt,
        createdAt: summary.createdAt,
        updatedAt: summary.updatedAt,
        identifiers: summary.identifiers,
        series,
        storedBytes,
      },
    },
  };
};

const readEvents = ({ clientRef, code }) =>
  readRecordEventsUseCase({
    kind: RECORD_KINDS.APPLICATION,
    code,
    ref: clientRef,
  });

// Too large to show is known from the stored size, so an oversized document
// is never fetched.
const readRaw = async ({ clientRef, code }) => {
  const { document, storedBytes } = orNotFound(
    await findApplicationDocument(
      { clientRef, code },
      { maxBytes: SECTION_CAP_BYTES },
    ),
  );

  logger.info(`Read application document: ${storedBytes} bytes`);

  return {
    content: { raw: document && withJsonNumbers(document), storedBytes },
    tooLarge: document === null,
  };
};

const APPLICATION_TABS = {
  overview: {
    readTab: readOverview,
    empty: { overview: null },
    withCounterpart: true,
  },
  events: { readTab: readEvents, empty: { events: null } },
  raw: {
    readTab: readRaw,
    empty: { raw: null, storedBytes: null },
    capped: "raw",
  },
};

export const buildViewApplicationAudit = (
  { clientRef, code, tab, caller, accounts },
  error,
) =>
  buildAuditEvent({
    entity: auditEntities.APPLICATION,
    action: auditActions.VIEW_APPLICATION,
    entityid: clientRef,
    details: { caller, code, tab, ...(error ? {} : accounts) },
    security: PMC_0706_SECURITY,
    segregationRef: "admin-view-application",
  });

const viewApplicationPage = (args) => {
  const tab = APPLICATION_TABS[args.tab];

  return composeRecordPage({
    readHeader: readApplicationHeader,
    tab,
    args: { ...args, withCounterpart: tab.withCounterpart === true },
  });
};

const auditedViewApplicationPage = auditedRead(
  viewApplicationPage,
  (args, result, error) =>
    buildViewApplicationAudit({ ...args, accounts: result?.accounts }, error),
);

export const viewApplicationPageUseCase = async ({
  code,
  clientRef,
  tab,
  caller,
}) => {
  logger.info(`View application ${tab}`);

  const { page } = await auditedViewApplicationPage({
    code,
    clientRef,
    tab,
    caller,
  });

  return page;
};
