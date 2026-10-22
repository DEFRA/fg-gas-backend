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
  findGrantVersionEntitlements,
  findStoredGrantDefinition,
} from "../../grants/services/config-version.service.js";
import { findStoredPaymentDefinitionUseCase } from "../../payments/use-cases/find-stored-payment-definition.use-case.js";
import {
  SECTION_CAP_BYTES,
  composeRecordPage,
} from "../services/compose-record-page.js";
import {
  grantVersionNotFound,
  noDefinitionFile,
} from "../services/grant-not-found.js";

// A version without the tab's Definition File has no such tab.
const assertTabFile = ({ file }, files) => {
  if (file && !files[file]) {
    throw noDefinitionFile();
  }
};

const readGrantVersionHeader = async ({ code, version, tab }) => {
  const [found, grant] = await Promise.all([
    findConfigVersionFiles({ code, version }),
    findConfigVersions(code),
  ]);

  if (!found || !grant) {
    throw grantVersionNotFound();
  }

  assertTabFile(GRANT_VERSION_TABS[tab], found.files);

  return { header: { ...found, versions: grant.versions }, accounts: null };
};

const readOverview = async ({ code, version }) => ({
  content: { overview: await findGrantDefinitionSummary({ code, version }) },
});

// Too large only when stored: a file not stored has no size.
const toCappedRead = (key, { definition, storedBytes }) => ({
  content: { [key]: definition && withJsonNumbers(definition) },
  tooLarge: storedBytes !== null && definition === null,
});

const readDefinition = async ({ code, version }) =>
  toCappedRead(
    "definition",
    await findStoredGrantDefinition(
      { code, version },
      { maxBytes: SECTION_CAP_BYTES },
    ),
  );

const readStoredPayment = ({ code, version }) =>
  findStoredPaymentDefinitionUseCase(
    { code, version },
    { maxBytes: SECTION_CAP_BYTES },
  );

const readPayment = async ({ code, version }) =>
  toCappedRead("payment", await readStoredPayment({ code, version }));

// No tab file: every version has a grant file, and a payment file is optional.
const readEntitlements = async ({ code, version }) => {
  const [entitlements, payment] = await Promise.all([
    findGrantVersionEntitlements({ code, version }),
    readStoredPayment({ code, version }),
  ]);
  const { content, tooLarge } = toCappedRead("payment", payment);

  return {
    content: { entitlements: entitlements && { ...entitlements, ...content } },
    tooLarge: entitlements !== null && tooLarge,
  };
};

const GRANT_VERSION_TABS = {
  overview: { readTab: readOverview, empty: { overview: null } },
  definition: {
    readTab: readDefinition,
    empty: { definition: null },
    capped: "definition",
  },
  payment: {
    readTab: readPayment,
    empty: { payment: null },
    capped: "payment",
    file: "payment",
  },
  entitlements: {
    readTab: readEntitlements,
    empty: { entitlements: null },
    capped: "entitlements",
  },
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
