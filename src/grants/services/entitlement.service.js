import Boom from "@hapi/boom";
import { loadEntitlementReferenceContext } from "../../agreements/use-cases/load-entitlement-reference-context.js";
import { auditActions, auditEntities } from "../../common/audit-constants.js";
import { logger } from "../../common/logger.js";
import {
  resolveRefs,
  UnresolvedReferenceError,
} from "../../common/resolve-refs.js";
import { buildAuditEvent, withAudit } from "../../common/with-audit.js";
import { withTransaction } from "../../common/with-transaction.js";
import { EntitlementCreationRejection } from "../models/entitlement-template.js";
import { Entitlement } from "../models/entitlement.js";
import { lockForUpdate } from "../repositories/application.repository.js";
import {
  findExistingEntitlements,
  insertEntitlement,
} from "../repositories/entitlement.repository.js";
import { findApplicationByClientRefAndCodeUseCase } from "../use-cases/find-application-by-client-ref-and-code.use-case.js";
import {
  pinnedVersionOf,
  resolveCurrentGrantUseCase,
} from "../use-cases/resolve-current-grant.use-case.js";

const retries = 1;
const httpNotFound = 404;

const retryReasons = {
  SLOT_TAKEN: "SLOT_TAKEN",
  CONFIG_CHANGED: "CONFIG_CHANGED",
};

class RetryCreation extends Error {
  constructor(reason) {
    super(`Entitlement creation abandoned: ${reason}`);
    this.reason = reason;
  }
}

const withErrorCode = (boom, errorCode) => {
  boom.output.payload.errorCode = errorCode;
  return boom;
};

const applicationNotFound = ({ code, clientRef }) =>
  withErrorCode(
    Boom.notFound(
      `No matching application found for clientRef '${clientRef}' and grantCode '${code}'.`,
    ),
    "APPLICATION_NOT_FOUND",
  );

const mapApplicationNotFound = async (command) => {
  try {
    return await findApplicationByClientRefAndCodeUseCase(
      command.clientRef,
      command.code,
    );
  } catch (error) {
    if (error.isBoom && error.output.statusCode === httpNotFound) {
      throw applicationNotFound(command);
    }

    throw error;
  }
};

const toEntitlementDto = (entitlement) => ({
  id: entitlement.id,
  clientRef: entitlement.clientRef,
  code: entitlement.code,
  claimCode: entitlement.claimCode,
  instanceNumber: entitlement.instanceNumber,
  configVersion: entitlement.configVersion,
  data: structuredClone(entitlement.data),
  createdAt: entitlement.createdAt,
});

const toCreationOption = (template, existing) => {
  const createdCount = existing.filter(
    (entitlement) => entitlement.claimCode === template.claimCode,
  ).length;

  return {
    claimCode: template.claimCode,
    name: template.name,
    description: template.description,
    materialised: template.materialised,
    fields: structuredClone(template.fields),
    maxEntitlements: template.maxEntitlements,
    availableAt: structuredClone(template.availableAt),
    help: structuredClone(template.help),
    claim: structuredClone(template.claim),
    createdCount,
    remainingCapacity: template.maxEntitlements - createdCount,
  };
};

const resolveEntitlements = async ({ code, clientRef }) => {
  const application = await findApplicationByClientRefAndCodeUseCase(
    clientRef,
    code,
  );
  const { grant } = await resolveCurrentGrantUseCase(
    code,
    pinnedVersionOf(application),
  );
  const existing = await findExistingEntitlements(clientRef, code);
  const offerable = grant
    .findEntitlementTemplatesAvailableAt(application.currentPosition())
    .filter((template) => !template.materialised);

  return { application, grant, offerable, existing };
};

const overviewDto = ({ application, grant, offerable, existing }) => ({
  entitlements: existing.map(toEntitlementDto),
  creationOptions: offerable.map((template) =>
    toCreationOption(template, existing),
  ),
  applicationContext: application.referenceContext(),
  claimsPage: structuredClone(grant.pages?.claims),
});

const availableCreationTemplate = ({
  grant,
  application,
  claimCode,
  clientRef,
}) => {
  const template = grant.findEntitlementTemplate(claimCode);

  if (
    !template ||
    template.materialised ||
    !template.isAvailableAt(application.currentPosition())
  ) {
    throw Boom.notFound(
      `No entitlement available for claim code "${claimCode}" on application "${clientRef}"`,
    );
  }

  return template;
};

export const getEntitlementOverview = async ({ code, clientRef }) =>
  overviewDto(await resolveEntitlements({ code, clientRef }));

export const getEntitlementCreationDetails = async ({
  code,
  clientRef,
  claimCode,
}) => {
  const { application, grant, existing } = await resolveEntitlements({
    code,
    clientRef,
  });
  const template = availableCreationTemplate({
    grant,
    application,
    claimCode,
    clientRef,
  });

  const option = toCreationOption(template, existing);

  if (option.createdCount >= template.maxEntitlements) {
    throw Boom.conflict(
      `Application "${clientRef}" already has ${option.createdCount} of ${template.maxEntitlements} entitlements for claim code "${claimCode}"`,
    );
  }

  return option;
};

const flattenData = (data) =>
  Object.fromEntries(
    Object.entries(data).map(([name, field]) => [name, field.value]),
  );

const fixedFields = (template) =>
  Object.entries(template.fields ?? {}).filter(([, field]) => !field.input);

const needsResolution = (value) =>
  typeof value === "string" &&
  (value.startsWith("jsonata:") || /[$@]\./.test(value));

const unresolvedField = (name, claimCode, reference) => {
  logger.warn(
    { claimCode, field: name, reference },
    `Entitlement field "${name}" could not be resolved`,
  );

  return withErrorCode(
    Boom.badData(
      `Entitlement data for claim code '${claimCode}' could not be resolved: field '${name}' requests data the application does not provide.`,
    ),
    "ENTITLEMENT_DATA_UNRESOLVED",
  );
};

const resolveFixedField = async (name, field, context, claimCode) => {
  if (!needsResolution(field.value)) {
    return field.value;
  }

  try {
    return await resolveRefs(field.value, { context });
  } catch (error) {
    if (error instanceof UnresolvedReferenceError) {
      throw unresolvedField(name, claimCode, error.reference);
    }

    throw error;
  }
};

const resolveFixedData = async ({
  template,
  application,
  code,
  clientRef,
  session,
}) => {
  const fields = fixedFields(template);

  if (fields.length === 0) {
    return {};
  }

  const valuesNeedResolution = fields.some(([, field]) =>
    needsResolution(field.value),
  );
  const referenceContext = valuesNeedResolution
    ? await loadEntitlementReferenceContext({ code, clientRef }, session)
    : {};
  const applicationContext = application.referenceContext();
  const context = {
    ...applicationContext,
    application: applicationContext,
    ...referenceContext,
  };

  return Object.fromEntries(
    await Promise.all(
      fields.map(async ([name, field]) => [
        name,
        valuesNeedResolution
          ? await resolveFixedField(name, field, context, template.claimCode)
          : field.value,
      ]),
    ),
  );
};

const invalidClaimCode = ({ code, clientRef, claimCode, grant }) => {
  if (!grant.findEntitlementTemplate(claimCode)) {
    return withErrorCode(
      Boom.badData(
        `Claim code '${claimCode}' is not defined for grant code '${code}'.`,
      ),
      "INVALID_CLAIM_CODE",
    );
  }

  return withErrorCode(
    Boom.badData(
      `Claim code '${claimCode}' is not available for application '${clientRef}'.`,
    ),
    "INVALID_CLAIM_CODE",
  );
};

const byName = (a, b) => a.localeCompare(b);

const invalidDataMessage = ({ template, data, claimCode }) => {
  const expected = template.inputFieldNames().sort(byName);
  const submitted = Object.keys(data).sort(byName);
  const missing = expected.filter((name) => !submitted.includes(name));
  const unexpected = submitted.filter((name) => !expected.includes(name));
  const problems = [
    missing.length > 0 && `missing fields: ${missing.join(", ")}`,
    unexpected.length > 0 && `unexpected fields: ${unexpected.join(", ")}`,
  ].filter(Boolean);

  return `Entitlement data for claim code '${claimCode}' does not match the template: ${problems.join("; ")}.`;
};

const rejectedCreation = ({ reason, template, command }) => {
  if (reason === EntitlementCreationRejection.INVALID_ENTITLEMENT_DATA) {
    return withErrorCode(
      Boom.badData(
        invalidDataMessage({
          template,
          data: command.data,
          claimCode: command.claimCode,
        }),
      ),
      // Hard-coded, not EntitlementCreationRejection: this is the published
      // HTTP errorCode, and it only happens to share its spelling with the
      // domain reason. Pointing it at the enum would let a domain rename
      // silently change the contract callers depend on.
      "INVALID_ENTITLEMENT_DATA",
    );
  }

  if (reason === EntitlementCreationRejection.CAPACITY_REACHED) {
    return withErrorCode(
      Boom.conflict(
        `Cannot create entitlement '${command.claimCode}'. Maximum instance limit of ${template.maxEntitlements} has been reached.`,
      ),
      "ENTITLEMENT_LIMIT_EXCEEDED",
    );
  }

  return invalidClaimCode({ ...command, grant: command.grant });
};

const writeEntitlement = async ({ entitlement }, session) => {
  if ((await insertEntitlement(entitlement, session)) === false) {
    throw new RetryCreation(retryReasons.SLOT_TAKEN);
  }

  return entitlement;
};

const auditDataBuilder = (args, entitlement) => {
  if (!entitlement) {
    return null;
  }

  const { code, clientRef, claimCode } = args[0];

  return buildAuditEvent({
    entity: auditEntities.ENTITLEMENT,
    action: auditActions.CREATE,
    entityid: entitlement.id,
    details: { code, clientRef, claimCode },
  });
};

const writeEntitlementWithAudit = withAudit(writeEntitlement, auditDataBuilder);

const lockApplication = async (command, session) => {
  const application = await lockForUpdate(
    { clientRef: command.clientRef, code: command.code },
    session,
  );

  if (application === null) {
    throw applicationNotFound(command);
  }

  return application;
};

const entitlementCreationDecision = ({
  command,
  grant,
  application,
  existing,
}) => {
  const template = grant.findEntitlementTemplate(command.claimCode);

  if (!template) {
    throw invalidClaimCode({ ...command, grant });
  }

  const decision = template.assessEntitlementCreation(
    application.currentPosition(),
    existing,
    command.data,
  );

  if (!decision.allowed) {
    throw rejectedCreation({
      reason: decision.reason,
      template,
      command: { ...command, grant },
    });
  }

  return { template, decision };
};

const createInTransaction = async (
  { command, grant, pinnedVersion },
  session,
) => {
  const application = await lockApplication(command, session);

  if (pinnedVersionOf(application) !== pinnedVersion) {
    throw new RetryCreation(retryReasons.CONFIG_CHANGED);
  }

  const existing = await findExistingEntitlements(
    command.clientRef,
    command.code,
    session,
  );
  const { template, decision } = entitlementCreationDecision({
    command,
    grant,
    application,
    existing,
  });

  const entitlement = Entitlement.create({
    clientRef: command.clientRef,
    code: command.code,
    claimCode: command.claimCode,
    instanceNumber: decision.nextInstanceNumber,
    configVersion: application.currentConfigVersion,
    data: {
      ...flattenData(command.data),
      ...(await resolveFixedData({
        ...command,
        template,
        application,
        session,
      })),
    },
  });

  return writeEntitlementWithAudit({ entitlement, ...command }, session);
};

const createAttempt = async (command) => {
  const application = await mapApplicationNotFound(command);
  const pinnedVersion = pinnedVersionOf(application);
  const { grant } = await resolveCurrentGrantUseCase(
    command.code,
    pinnedVersion,
  );

  return withTransaction((session) =>
    createInTransaction({ command, grant, pinnedVersion }, session),
  );
};

const exhausted = (error, command) => {
  if (error.reason === retryReasons.SLOT_TAKEN) {
    return withErrorCode(
      Boom.conflict(
        `Cannot create entitlement '${command.claimCode}'. Maximum instance limit has been reached.`,
      ),
      "ENTITLEMENT_LIMIT_EXCEEDED",
    );
  }

  return withErrorCode(
    Boom.conflict(
      `Grant configuration for '${command.code}' changed while creating entitlement '${command.claimCode}'. Try again.`,
    ),
    "CONFIGURATION_CHANGED",
  );
};

const retryCreation = async (command, remaining) => {
  try {
    return await createAttempt(command);
  } catch (error) {
    if (!(error instanceof RetryCreation)) {
      throw error;
    }

    if (remaining === 0) {
      throw exhausted(error, command);
    }

    return retryCreation(command, remaining - 1);
  }
};

export const createEntitlement = (command) => retryCreation(command, retries);
