import Boom from "@hapi/boom";
import { auditActions, auditEntities } from "../../common/audit-constants.js";
import { isMongoDuplicateKeyError } from "../../common/mongo-errors.js";
import { buildAuditEvent, withAudit } from "../../common/with-audit.js";
import { withTransaction } from "../../common/with-transaction.js";
import { ClaimableEntitlement } from "../models/claimable-entitlement.js";
import { lockForUpdate } from "../repositories/application.repository.js";
import {
  countByClaimCode,
  existsByClientClaimRef,
  insert,
} from "../repositories/claim.repository.js";
import { findExistingEntitlements } from "../repositories/entitlement.repository.js";
import { findApplicationByClientRefAndCodeUseCase } from "../use-cases/find-application-by-client-ref-and-code.use-case.js";
import {
  pinnedVersionOf,
  resolveCurrentGrantUseCase,
} from "../use-cases/resolve-current-grant.use-case.js";

const retries = 1;

class RetryClaimSubmission extends Error {}

const grantCodeMismatch =
  "The grant code provided in the path parameters does not match the grant code specified in the payload metadata.";
const clientRefMismatch =
  "The client reference provided in the path parameters does not match the client reference specified in the payload metadata.";
const applicationNotClaimable =
  "Application is not in a valid state to accept claims for this entitlement.";
const maximumClaimsReached =
  "Maximum number of claims for this entitlement has been reached.";

const assertPathMatchesPayload = (code, clientRef, metadata) => {
  if (code !== metadata.grantCode) {
    throw Boom.badRequest(grantCodeMismatch);
  }
  if (clientRef !== metadata.clientRef) {
    throw Boom.badRequest(clientRefMismatch);
  }
};

const applicationNotFound = ({ code, clientRef }) =>
  Boom.notFound(
    `Application with clientRef "${clientRef}" and code "${code}" not found`,
  );

const resolveGrant = async ({ code, pinnedVersion }) => {
  const { grant } = await resolveCurrentGrantUseCase(code, pinnedVersion);
  if (!grant) {
    throw Boom.notFound(`Grant with code "${code}" not found`);
  }
  return grant;
};

const materialisedCandidate = (template, application) =>
  ClaimableEntitlement.fromMaterialised({
    template,
    code: application.code,
    clientRef: application.clientRef,
  });

const persistedCandidates = (template, existing) =>
  existing
    .filter((entitlement) => entitlement.claimCode === template.claimCode)
    .map((entitlement) =>
      ClaimableEntitlement.fromPersisted({ entitlement, template }),
    );

const candidatesForTemplate = ({ template, application, existing }) => {
  if (!template.claim) {
    return [];
  }
  return template.materialised
    ? [materialisedCandidate(template, application)]
    : persistedCandidates(template, existing);
};

const candidatesFor = ({ grant, application, existing }) =>
  grant.entitlementTemplates.flatMap((template) =>
    candidatesForTemplate({ template, application, existing }),
  );

const claimableFor = ({ grant, application, existing, claimCode }) => {
  const template = grant.findEntitlementTemplate(claimCode);
  if (!template) {
    throw Boom.notFound(
      `Entitlement template with claimCode "${claimCode}" not found for grant "${application.code}"`,
    );
  }
  const candidates = candidatesForTemplate({ template, application, existing });
  if (candidates.length === 0) {
    throw Boom.notFound(
      `Entitlement with claimCode "${claimCode}" not found for application "${application.clientRef}"`,
    );
  }
  if (candidates.length > 1) {
    throw Boom.badImplementation(
      `Claim code "${claimCode}" does not identify a single entitlement.`,
    );
  }
  return candidates[0];
};

const dataValue = (field, value) => value ?? field.value ?? null;

const decimalDataField = (field, value) => ({
  value: dataValue(field, value),
  decimalPlaces: field.decimalPlaces,
  minValue: field.minValue ?? null,
  maxValue: field.maxValue ?? null,
});

const dataField = (field, value) => {
  if (field.unitType === "decimal") {
    return decimalDataField(field, value);
  }
  return { value: dataValue(field, value) };
};

const claimData = (claimable) =>
  Object.fromEntries(
    Object.entries(claimable.fields ?? {}).map(([name, field]) => [
      name,
      dataField(field, claimable.entitlement?.data?.[name]),
    ]),
  );

const entitlementDetails = (entitlement) =>
  entitlement
    ? {
        entitlementId: entitlement.id,
        instanceNumber: entitlement.instanceNumber,
      }
    : { entitlementId: null, instanceNumber: null };

const toClaimableDto = (claimable) => ({
  source: claimable.type,
  code: claimable.claimCode,
  name: claimable.name,
  description: claimable.description ?? null,
  data: claimData(claimable),
  ...entitlementDetails(claimable.entitlement),
  claim: structuredClone(claimable.claim),
});

const countClaimsFor = (claimable) =>
  countByClaimCode({
    code: claimable.code,
    clientRef: claimable.clientRef,
    claimCode: claimable.claimCode,
  });

const isAvailable = async (claimable, position) =>
  claimable.canAcceptClaim(position, await countClaimsFor(claimable)).allowed;

export const listClaimableEntitlements = async ({ code, clientRef }) => {
  const application = await findApplicationByClientRefAndCodeUseCase(
    clientRef,
    code,
  );
  const grant = await resolveGrant({
    code,
    pinnedVersion: pinnedVersionOf(application),
  });
  const existing = await findExistingEntitlements(clientRef, code);
  const position = application.currentPosition();

  const available = await Promise.all(
    candidatesFor({ grant, application, existing }).map(async (claimable) =>
      (await isAvailable(claimable, position)) ? claimable : null,
    ),
  );

  return available.filter(Boolean).map(toClaimableDto);
};

const existingReplay = ({ code, clientRef, clientClaimRef }, session) =>
  existsByClientClaimRef({ code, clientRef, clientClaimRef }, session).then(
    (exists) => (exists ? { created: false } : null),
  );

const auditDataBuilder = (args, result) => {
  if (!result?.created) {
    return null;
  }
  const [{ command }] = args;
  return buildAuditEvent({
    entity: auditEntities.CLAIM,
    action: auditActions.SUBMIT,
    entityid: result.claimId,
    details: {
      code: command.code,
      clientRef: command.clientRef,
      claimCode: command.payload.metadata.claimCode,
    },
  });
};

const insertClaim = async ({ command }, session) => {
  const insertedId = await insert(
    {
      code: command.code,
      clientRef: command.clientRef,
      claimCode: command.payload.metadata.claimCode,
      clientClaimRef: command.payload.metadata.clientClaimRef,
      metadata: command.payload.metadata,
      claim: command.payload.claim,
    },
    session,
  );
  return { created: true, claimId: insertedId.toString() };
};

const insertClaimWithAudit = withAudit(insertClaim, auditDataBuilder);

const lockedApplicationFor = async (command, pinnedVersion, session) => {
  const application = await lockForUpdate(
    { clientRef: command.clientRef, code: command.code },
    session,
  );
  if (!application) {
    throw applicationNotFound(command);
  }
  if (pinnedVersionOf(application) !== pinnedVersion) {
    throw new RetryClaimSubmission();
  }
  return application;
};

const claimableWithCapacity = async (
  { command, grant, application },
  session,
) => {
  const existing = await findExistingEntitlements(
    command.clientRef,
    command.code,
    session,
  );
  const claimable = claimableFor({
    grant,
    application,
    existing,
    claimCode: command.payload.metadata.claimCode,
  });
  const count = await countByClaimCode(
    {
      code: command.code,
      clientRef: command.clientRef,
      claimCode: claimable.claimCode,
    },
    session,
  );
  const decision = claimable.canAcceptClaim(
    application.currentPosition(),
    count,
  );
  if (!decision.allowed) {
    throw decision.reason === "MAXIMUM_CLAIMS_REACHED"
      ? Boom.badData(maximumClaimsReached)
      : Boom.conflict(applicationNotClaimable);
  }
  return claimable;
};

const submitInTransaction = async (
  { command, grant, pinnedVersion },
  session,
) => {
  const application = await lockedApplicationFor(
    command,
    pinnedVersion,
    session,
  );

  const replay = await existingReplay(
    { ...command, clientClaimRef: command.payload.metadata.clientClaimRef },
    session,
  );
  if (replay) {
    return replay;
  }

  await claimableWithCapacity({ command, grant, application }, session);

  return insertClaimWithAudit({ command }, session);
};

const replayAfterDuplicate = async (error, command) => {
  if (!isMongoDuplicateKeyError(error)) {
    return null;
  }
  return existingReplay({
    code: command.code,
    clientRef: command.clientRef,
    clientClaimRef: command.payload.metadata.clientClaimRef,
  });
};

const isRetriable = (error) =>
  error instanceof RetryClaimSubmission || isMongoDuplicateKeyError(error);

const exhausted = (command) =>
  Boom.conflict(
    `Claim '${command.payload.metadata.clientClaimRef}' could not be submitted because the application changed concurrently. Try again.`,
  );

const retryOrThrow = async (error, command, attempt) => {
  const replay = await replayAfterDuplicate(error, command);
  if (replay) {
    return replay;
  }
  if (!isRetriable(error)) {
    throw error;
  }
  if (attempt === retries) {
    throw exhausted(command);
  }
  return submitAttempt(command, attempt + 1);
};

const submitAttempt = async (command, attempt) => {
  const application = await findApplicationByClientRefAndCodeUseCase(
    command.clientRef,
    command.code,
  );
  const pinnedVersion = pinnedVersionOf(application);
  const grant = await resolveGrant({ code: command.code, pinnedVersion });
  try {
    return await withTransaction((session) =>
      submitInTransaction({ command, grant, pinnedVersion }, session),
    );
  } catch (error) {
    return retryOrThrow(error, command, attempt);
  }
};

const submitValidClaim = async (command) => {
  const replay = await existingReplay({
    code: command.code,
    clientRef: command.clientRef,
    clientClaimRef: command.payload.metadata.clientClaimRef,
  });
  return replay ?? submitAttempt(command, 0);
};

export const submitClaim = ({ code, clientRef, payload }) => {
  assertPathMatchesPayload(code, clientRef, payload.metadata);
  return submitValidClaim({ code, clientRef, payload });
};
