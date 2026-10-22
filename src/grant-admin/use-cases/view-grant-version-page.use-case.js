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
  findConfigVersionFiles,
  findConfigVersions,
  findGrantDefinitionSummary,
  findGrantLifecycle,
  findStoredGrantDefinition,
} from "../../grants/services/config-version.service.js";
import {
  SECTION_CAP_BYTES,
  composeRecordPage,
} from "../services/compose-record-page.js";
import { grantVersionNotFound } from "../services/grant-not-found.js";

const readGrantVersionHeader = async ({ code, version }) => {
  const [found, grant] = await Promise.all([
    findConfigVersionFiles({ code, version }),
    findConfigVersions(code),
  ]);

  if (!found || !grant) {
    throw grantVersionNotFound();
  }

  return { header: { ...found, versions: grant.versions }, accounts: null };
};

const readOverview = async ({ code, version }) => ({
  content: { overview: await findGrantDefinitionSummary({ code, version }) },
});

// Too large only when stored: a grant file not stored has no size.
const readDefinition = async ({ code, version }) => {
  const { definition, storedBytes } = await findStoredGrantDefinition(
    { code, version },
    { maxBytes: SECTION_CAP_BYTES },
  );

  return {
    content: { definition: definition && withJsonNumbers(definition) },
    tooLarge: storedBytes !== null && definition === null,
  };
};

const NO_LIFECYCLE = { lifecycle: null, problem: null };

const readPhases = async ({ code, version }) => ({
  content: (await findGrantLifecycle({ code, version })) ?? NO_LIFECYCLE,
});

const GRANT_VERSION_TABS = {
  overview: { readTab: readOverview, empty: { overview: null } },
  definition: {
    readTab: readDefinition,
    empty: { definition: null },
    capped: "definition",
  },
  phases: { readTab: readPhases, empty: NO_LIFECYCLE },
};

export const buildViewGrantVersionAudit = ({ code, version, tab, caller }) =>
  buildAuditEvent({
    entity: auditEntities.GRANT,
    action: auditActions.VIEW_GRANT_VERSION,
    entityid: code,
    details: { caller, version, tab },
    security: PMC_0706_SECURITY,
    segregationRef: "admin-view-grant-version",
  });

const viewGrantVersionPage = (args) =>
  composeRecordPage({
    readHeader: readGrantVersionHeader,
    tab: GRANT_VERSION_TABS[args.tab],
    args,
  });

const auditedViewGrantVersionPage = auditedRead(
  viewGrantVersionPage,
  buildViewGrantVersionAudit,
);

export const viewGrantVersionPageUseCase = async ({
  code,
  version,
  tab,
  caller,
}) => {
  logger.info(`View grant version ${tab}`);

  const { page } = await auditedViewGrantVersionPage({
    code,
    version,
    tab,
    caller,
  });

  return page;
};
