import Boom from "@hapi/boom";
import { loadEntitlementReferenceContext } from "../../agreements/use-cases/load-entitlement-reference-context.js";
import { auditActions, auditEntities } from "../../events/audit-constants.js";
import { findConfigDefinition } from "../../common/config-broker/config-catalog.repository.js";
import { isMongoDuplicateKeyError } from "../../common/mongo-errors.js";
import { internalEventTarget, saveEvents } from "../../events/index.js";
import { buildAuditEvent, withAudit } from "../../events/with-audit.js";
import { withTransaction } from "../../common/with-transaction.js";
import { ClaimPaymentRequestedEvent } from "../events/claim-payment-requested.event.js";
import { Claim } from "../models/claim.js";
import { ClaimableEntitlement } from "../models/claimable-entitlement.js";
import { lockForUpdate } from "../repositories/application.repository.js";
import {
  countByEntitlement,
  existsByClientClaimRef,
  findByApplication,
  insert,
} from "../repositories/claim.repository.js";
import { findExistingEntitlements } from "../repositories/entitlement.repository.js";
import { toClaimableDto } from "./map-claimable-entitlement.js";
import { toSubmittedClaim } from "./map-submitted-claim.js";
import { findApplicationByClientRefAndCodeUseCase } from "../use-cases/find-application-by-client-ref-and-code.use-case.js";
import { hasRemainingApplicationClaimCapacityUseCase } from "../use-cases/has-remaining-application-claim-capacity.use-case.js";
import {
  pinnedVersionOf,
  resolveCurrentGrantUseCase,
} from "../use-cases/resolve-current-grant.use-case.js";
import { transitionApplicationUseCase } from "../use-cases/transition-application.use-case.js";

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

// instanceNumber is unique only within a claim code, so entitlements are
// ordered inside their template rather than across the whole list.
const byInstanceNumber = (one, other) =>
  one.instanceNumber - other.instanceNumber;

const persistedCandidates = (template, existing) =>
  existing
    .filter((entitlement) => entitlement.claimCode === template.claimCode)
    .sort(byInstanceNumber)
    .map((entitlement) =>
      ClaimableEntitlement.fromPersisted({ entitlement, template }),
    );

const candidatesForTemplate = ({ template, existing }) => {
  if (!template.claim) {
    return [];
  }
  return template.materialised ? [] : persistedCandidates(template, existing);
};

const candidatesFor = ({ grant, existing }) =>
  grant.entitlementTemplates.flatMap((template) =>
    candidatesForTemplate({ template, existing }),
  );

const claimableFor = ({ grant, application, existing, entitlementId }) => {
  const entitlement = existing.find(
    (candidate) => candidate.id === entitlementId,
  );

  if (!entitlement) {
    throw Boom.notFound(
      `Entitlement "${entitlementId}" not found for application "${application.clientRef}"`,
    );
  }

  const template = grant.findEntitlementTemplate(entitlement.claimCode);

  if (!template?.claim) {
    throw Boom.notFound(
      `Entitlement template with claimCode "${entitlement.claimCode}" not found for grant "${application.code}"`,
    );
  }

  return ClaimableEntitlement.fromPersisted({ entitlement, template });
};

const countClaimsFor = (claimable) =>
  countByEntitlement({
    code: claimable.code,
    clientRef: claimable.clientRef,
    entitlementId: claimable.entitlement.id,
  });

const isClaimableNow = async (claimable, application) =>
  claimable.canAcceptClaim(
    application.currentPosition(),
    await countClaimsFor(claimable),
  ).allowed;

const applicationAndGrant = async ({ code, clientRef }) => {
  const application = await findApplicationByClientRefAndCodeUseCase(
    clientRef,
    code,
  );
  const grant = await resolveGrant({
    code,
    pinnedVersion: pinnedVersionOf(application),
  });

  return { application, grant };
};

const candidatesForApplication = async ({ code, clientRef }) => {
  const { application, grant } = await applicationAndGrant({ code, clientRef });
  const existing = await findExistingEntitlements(clientRef, code);

  return { application, candidates: candidatesFor({ grant, existing }) };
};

const listEntitlementsMatching = async ({ code, clientRef }, isEligible) => {
  const { application, candidates } = await candidatesForApplication({
    code,
    clientRef,
  });

  const matched = await Promise.all(
    candidates.map(async (claimable) =>
      (await isEligible(claimable, application)) ? claimable : null,
    ),
  );

  return matched.filter(Boolean).map(toClaimableDto);
};

// Every Claim submitted against one application, resolved against the template
// it was made under. Whether a Payment exists for it belongs to Payments, so
// the adapter that can read both joins it on.
export const listSubmittedClaims = async ({ code, clientRef }) => {
  const claims = await findByApplication({ code, clientRef });

  if (claims.length === 0) {
    return [];
  }

  const { grant } = await applicationAndGrant({ code, clientRef });

  return claims.map((claim) => toSubmittedClaim({ claim, grant }));
};

export const listClaimableEntitlements = ({ code, clientRef }) =>
  listEntitlementsMatching({ code, clientRef }, isClaimableNow);

const withClaimCount = async (claimable) => ({
  claimable,
  claimCount: await countClaimsFor(claimable),
});

export const listEntitlementsWithClaimCapacity = async ({
  code,
  clientRef,
}) => {
  const { candidates } = await candidatesForApplication({ code, clientRef });
  const counted = await Promise.all(candidates.map(withClaimCount));

  return counted
    .filter(({ claimable, claimCount }) =>
      claimable.hasRemainingCapacity(claimCount),
    )
    .map(({ claimable, claimCount }) => ({
      ...toClaimableDto(claimable),
      canEdit: claimable.canBeChanged(claimCount),
    }));
};

// The entitlement a case officer is about to change, refused once a Claim has
// been made against it.
export const getChangeableEntitlement = async ({
  code,
  clientRef,
  entitlementId,
}) => {
  const { candidates } = await candidatesForApplication({ code, clientRef });
  const claimable = candidates.find(
    (candidate) => candidate.entitlement.id === entitlementId,
  );

  if (!claimable) {
    throw Boom.notFound(
      `Entitlement "${entitlementId}" not found for application "${clientRef}"`,
    );
  }

  if (!claimable.canBeChanged(await countClaimsFor(claimable))) {
    throw Boom.conflict(
      `${claimable.name} has a claim against it and cannot be changed.`,
    );
  }

  return { ...toClaimableDto(claimable), canEdit: true };
};

const existingReplay = ({ code, clientRef, clientClaimRef }, session) =>
  existsByClientClaimRef({ code, clientRef, clientClaimRef }, session).then(
    (exists) => (exists ? { created: false } : null),
  );

const auditDataBuilder = (args, result) => {
  if (!result?.created) {
    return null;
  }
  const [{ command, claimCode }] = args;
  return buildAuditEvent({
    entity: auditEntities.CLAIM,
    action: auditActions.SUBMIT,
    entityid: result.claimId,
    details: {
      code: command.code,
      clientRef: command.clientRef,
      claimCode,
    },
  });
};

const insertClaim = async ({ command, claimCode }, session) => {
  const claim = Claim.create({
    code: command.code,
    clientRef: command.clientRef,
    claimCode,
    clientClaimRef: command.payload.metadata.clientClaimRef,
    metadata: command.payload.metadata,
    claim: command.payload.claim,
  });
  const insertedId = await insert(claim, session);

  return {
    created: true,
    claimId: insertedId.toString(),
    createdAt: claim.createdAt,
  };
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
    entitlementId: command.payload.claim.entitlementId,
  });

  const count = await countByEntitlement(
    {
      code: command.code,
      clientRef: command.clientRef,
      entitlementId: claimable.entitlement.id,
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

// Read outside the transaction only to identify the entitlement's template;
// the authoritative read and every claim check happen inside it.
const claimTemplateFor = async ({ command, grant }) => {
  const existing = await findExistingEntitlements(
    command.clientRef,
    command.code,
  );
  const { entitlementId } = command.payload.claim;
  const entitlement = existing.find(
    (candidate) => candidate.id === entitlementId,
  );

  if (!entitlement) {
    throw Boom.notFound(
      `Entitlement "${entitlementId}" not found for application "${command.clientRef}"`,
    );
  }

  return grant.findEntitlementTemplate(entitlement.claimCode);
};

const templatePaysOnSubmission = (template) =>
  Boolean(template?.claim) && !template.claim.requiresApproval;

const claimFacts = ({ metadata, claim }) => ({
  sbi: metadata.sbi,
  frn: metadata.frn,
  totalAmountPence: claim.totalClaimAmountPence,
});

// Check the optional definition without loading or evaluating it: mapping
// belongs to Payments and must not make an accepted Claim fail.
const claimPaymentFor = async ({ command, grant, configVersion }) => {
  const template = await claimTemplateFor({ command, grant });

  if (!templatePaysOnSubmission(template) || !configVersion) {
    return false;
  }

  const definition = await findConfigDefinition({
    grantCode: command.code,
    version: configVersion,
    definitionType: "payment",
  });
  return Boolean(definition);
};

const agreementFor = async ({ code, clientRef }, session) => {
  const { agreement } = await loadEntitlementReferenceContext(
    { code, clientRef },
    session,
  );

  if (!agreement) {
    throw Boom.badImplementation(
      `Claim for "${clientRef}" has no Agreement to report its Payment against`,
    );
  }

  return agreement;
};

const requestClaimPayment = async (
  { command, claimable, configVersion, paymentConfigured, executedAt },
  session,
) => {
  if (!paymentConfigured || claimable.claim?.requiresApproval) {
    return;
  }

  const agreement = await agreementFor(command, session);
  const event = new ClaimPaymentRequestedEvent({
    code: command.code,
    clientRef: command.clientRef,
    clientClaimRef: command.payload.metadata.clientClaimRef,
    entitlementId: command.payload.claim.entitlementId,
    configVersion,
    agreement: {
      agreementNumber: agreement.agreementNumber,
      agreementVersion: agreement.version,
      correlationId: agreement.correlationId,
    },
    executedAt,
    claim: claimFacts(command.payload),
  });

  await saveEvents(
    [
      {
        event,
        target: internalEventTarget,
        segregationRef: command.clientRef,
      },
    ],
    session,
  );
};

const transitionOnFinalClaim = async (
  { grant, application, claimable },
  session,
) => {
  if (claimable.claim.requiresApproval) {
    return;
  }

  const targetPosition = grant.claimApprovalTransitionFor(
    application.currentPosition(),
  );
  if (!targetPosition) {
    return;
  }

  const existing = await findExistingEntitlements(
    application.clientRef,
    application.code,
    session,
  );
  const claimables = candidatesFor({ grant, existing });
  if (
    await hasRemainingApplicationClaimCapacityUseCase(
      { application, claimables },
      session,
    )
  ) {
    return;
  }

  await transitionApplicationUseCase(
    {
      application,
      grant,
      targetPosition,
      publishCaseWorkingStatusUpdate: true,
      sideEffectContext: {
        clientRef: application.clientRef,
        code: application.code,
      },
    },
    session,
  );
};

const submitInTransaction = async (
  { command, grant, pinnedVersion, paymentConfigured },
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

  const claimable = await claimableWithCapacity(
    { command, grant, application },
    session,
  );

  const { createdAt, ...result } = await insertClaimWithAudit(
    { command, claimCode: claimable.claimCode },
    session,
  );

  await transitionOnFinalClaim({ grant, application, claimable }, session);

  await requestClaimPayment(
    {
      command,
      claimable,
      configVersion: pinnedVersion,
      paymentConfigured,
      executedAt: createdAt,
    },
    session,
  );

  return result;
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
  const grant = await resolveGrant({
    code: command.code,
    pinnedVersion,
  });
  const paymentConfigured = await claimPaymentFor({
    command,
    grant,
    configVersion: pinnedVersion,
  });
  try {
    return await withTransaction((session) =>
      submitInTransaction(
        { command, grant, pinnedVersion, paymentConfigured },
        session,
      ),
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
