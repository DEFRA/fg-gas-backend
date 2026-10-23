import { findStoredDefinition } from "../../common/config-broker/definition-stores.js";
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
  findGrantVersionEntitlements,
  findStoredGrantDefinition,
} from "../../grants/services/config-version.service.js";
import { findStoredPaymentDefinitionUseCase } from "../../payments/use-cases/find-stored-payment-definition.use-case.js";
import { findCwWorkflowVersionExistence } from "../repositories/cw-workflows.repository.js";
import {
  SECTION_CAP_BYTES,
  composeRecordPage,
} from "../services/compose-record-page.js";
import {
  grantVersionNotFound,
  noDefinitionFile,
} from "../services/grant-not-found.js";
import { readCounterpart } from "./read-counterpart.js";
import { readGrantVersionEventsUseCase } from "./read-record-events.use-case.js";

// A version without the tab's Definition File has no such tab.
const assertTabFile = ({ file }, files) => {
  if (file && !files[file]) {
    throw noDefinitionFile();
  }
};

const readWorkflowLink = (ref) =>
  readCounterpart(
    "Grant version page: workflow link",
    async () => (await findCwWorkflowVersionExistence(ref)).exists,
  );

// Only a tab that shows the workflow link asks Caseworking for it.
const readGrantVersionHeader = async ({
  code,
  version,
  tab,
  withCounterpart,
}) => {
  const [found, grant, counterpart] = await Promise.all([
    findConfigVersionFiles({ code, version }),
    findConfigVersions(code),
    withCounterpart ? readWorkflowLink({ code, version }) : null,
  ]);

  if (!found || !grant) {
    throw grantVersionNotFound();
  }

  assertTabFile(GRANT_VERSION_TABS[tab], found.files);

  return {
    header: { ...found, versions: grant.versions, counterpart },
    accounts: null,
  };
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

const NO_LIFECYCLE = { lifecycle: null, problem: null };

const readPhases = async ({ code, version }) => ({
  content: (await findGrantLifecycle({ code, version })) ?? NO_LIFECYCLE,
});

const readAgreement = async ({ code, version }) => {
  const found = await findStoredDefinition(
    "agreement",
    { grantCode: code, version },
    { maxBytes: SECTION_CAP_BYTES },
  );

  if (!found) {
    return { content: { agreement: null } };
  }

  return {
    content: {
      agreement: {
        ...found,
        definition: found.definition && withJsonNumbers(found.definition),
      },
    },
    tooLarge: found.definition === null,
  };
};

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

const readEvents = ({ code, version }) =>
  readGrantVersionEventsUseCase({ code, version });

const GRANT_VERSION_TABS = {
  overview: {
    readTab: readOverview,
    empty: { overview: null },
    withCounterpart: true,
  },
  definition: {
    readTab: readDefinition,
    empty: { definition: null },
    capped: "definition",
  },
  phases: { readTab: readPhases, empty: NO_LIFECYCLE, withCounterpart: true },
  payment: {
    readTab: readPayment,
    empty: { payment: null },
    capped: "payment",
    file: "payment",
  },
  agreement: {
    readTab: readAgreement,
    empty: { agreement: null },
    capped: "agreement",
    file: "agreement",
  },
  entitlements: {
    readTab: readEntitlements,
    empty: { entitlements: null },
    capped: "entitlements",
  },
  events: { readTab: readEvents, empty: { events: null } },
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

const viewGrantVersionPage = (args) => {
  const tab = GRANT_VERSION_TABS[args.tab];

  return composeRecordPage({
    readHeader: readGrantVersionHeader,
    tab,
    args: { ...args, withCounterpart: tab.withCounterpart === true },
  });
};

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
