import { logger } from "../../common/logger.js";
import {
  ADMIN_READ_SECURITY,
  auditActions,
  auditEntities,
} from "../../events/audit-constants.js";
import { withJsonNumbers } from "../../events/plain-json.js";
import { buildAuditEvent } from "../../events/with-audit.js";
import {
  findApplicationDocument,
  findApplicationSeries,
} from "../../grants/services/grant-admin.service.js";
import {
  orNotFound,
  readApplicationHeader,
  readApplicationSummary,
} from "../services/application-page.js";
import { SECTION_CAP_BYTES, viewRecordPage } from "../services/record-page.js";
import { readRecordEventsUseCase } from "./read-record-events.use-case.js";

const readSeries = async ({ clientRef, code }) => {
  const [series] = await findApplicationSeries({
    clientRefs: [clientRef],
    code,
  });

  return series ? { latestRef: series.latestRef, refs: series.refs } : null;
};

const readOverview = async ({ clientRef, code }) => {
  const [{ summary, storedBytes }, series] = await Promise.all([
    readApplicationSummary({ clientRef, code }),
    readSeries({ clientRef, code }),
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

const readEvents = ({ clientRef }) => readRecordEventsUseCase(clientRef);

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

export const APPLICATION_TABS = {
  overview: { readTab: readOverview, empty: { overview: null } },
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
    security: ADMIN_READ_SECURITY,
    segregationRef: "admin-view-application",
  });

const viewApplicationPage = viewRecordPage({
  readHeader: readApplicationHeader,
  tabs: APPLICATION_TABS,
  audit: buildViewApplicationAudit,
});

export const viewApplicationPageUseCase = ({
  code,
  clientRef,
  tab,
  caller,
}) => {
  logger.info(`View application ${tab}`);

  return viewApplicationPage({ code, clientRef, tab, caller });
};
