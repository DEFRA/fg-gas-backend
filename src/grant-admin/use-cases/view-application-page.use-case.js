import { RAW_CAP_BYTES } from "../../common/explore/stored-document.js";
import { logger } from "../../common/logger.js";
import {
  PMC_0706_SECURITY,
  auditActions,
  auditEntities,
} from "../../events/audit-constants.js";
import { auditedRead } from "../../events/audited-read.js";
import { buildAuditEvent } from "../../events/with-audit.js";
import {
  findApplicationDocument,
  findApplicationSeries,
} from "../../grants/services/application-read.service.js";
import { orNotFound } from "../services/application-not-found.js";
import { composeRecordPage } from "../services/compose-record-page.js";
import { rawSectionOf } from "../services/raw-section.js";
import {
  readApplicationHeader,
  readApplicationSummary,
} from "./application-page.helpers.js";
import { readApplicationEventsUseCase } from "./read-record-events.use-case.js";

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
  readApplicationEventsUseCase({ code, clientRef });

// Too large to show is known from the stored size, so an oversized document
// is never fetched.
const readRaw = async ({ clientRef, code }) => {
  const found = orNotFound(
    await findApplicationDocument(
      { clientRef, code },
      { maxBytes: RAW_CAP_BYTES },
    ),
  );

  logger.info(`Read application document: ${found.storedBytes} bytes`);

  return rawSectionOf(found);
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
    empty: { document: null, storedBytes: null },
    capped: "document",
    sized: true,
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
