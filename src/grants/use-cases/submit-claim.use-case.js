import Boom from "@hapi/boom";
import { logger } from "../../common/logger.js";
import { withTransaction } from "../../common/with-transaction.js";
import { lockForUpdate } from "../repositories/application.repository.js";
import {
  countByClaimCode,
  duplicateClientClaimRef,
  findByClientClaimRef,
  insert,
} from "../repositories/claim.repository.js";
import { resolveCurrentGrantUseCase } from "./resolve-current-grant.use-case.js";

const GRANT_CODE_MISMATCH =
  "The grant code provided in the path parameters does not match the grant code specified in the payload metadata.";
const CLIENT_REF_MISMATCH =
  "The client reference provided in the path parameters does not match the client reference specified in the payload metadata.";
const APPLICATION_NOT_CLAIMABLE =
  "Application is not in a valid state to accept claims for this entitlement.";
const MAXIMUM_CLAIMS_REACHED =
  "Maximum number of claims for this entitlement has been reached.";

const assertGrantCodeMatches = (pathGrantCode, metadataGrantCode) => {
  if (pathGrantCode !== metadataGrantCode) {
    throw Boom.badRequest(GRANT_CODE_MISMATCH);
  }
};

const assertClientRefMatches = (pathClientRef, metadataClientRef) => {
  if (pathClientRef !== metadataClientRef) {
    throw Boom.badRequest(CLIENT_REF_MISMATCH);
  }
};

const assertPathMatchesPayload = (grantCode, clientRef, metadata) => {
  assertGrantCodeMatches(grantCode, metadata.grantCode);
  assertClientRefMatches(clientRef, metadata.clientRef);
};

const lockAndLoadApplication = async (grantCode, clientRef, session) => {
  const application = await lockForUpdate(
    { clientRef, code: grantCode },
    session,
  );

  if (application === null) {
    throw Boom.notFound(
      `Application with clientRef "${clientRef}" and code "${grantCode}" not found`,
    );
  }

  return application;
};

const resolveClaimTemplate = async (grantCode, application, claimCode) => {
  const { grant } = await resolveCurrentGrantUseCase(
    grantCode,
    application.currentConfigVersion,
  );

  if (!grant) {
    throw Boom.notFound(`Grant with code "${grantCode}" not found`);
  }

  const template = grant.findEntitlementTemplate(claimCode);

  if (!template) {
    throw Boom.notFound(
      `Entitlement template with claimCode "${claimCode}" not found for grant "${grantCode}"`,
    );
  }

  return template;
};

const existingClaimResult = async (
  { code, clientRef, clientClaimRef },
  session,
) => {
  const existing = await findByClientClaimRef(
    { code, clientRef, clientClaimRef },
    session,
  );

  return existing ? { created: false } : null;
};

const assertApplicationIsClaimable = (application, template) => {
  if (!template.isClaimableAt(application.currentPosition())) {
    throw Boom.conflict(APPLICATION_NOT_CLAIMABLE);
  }
};

const assertUnderClaimLimit = async (
  { code, clientRef, claimCode, maximumClaims },
  session,
) => {
  const count = await countByClaimCode({ code, clientRef, claimCode }, session);

  if (count >= maximumClaims) {
    throw Boom.badData(MAXIMUM_CLAIMS_REACHED);
  }
};

const persistNewClaim = async ({ grantCode, clientRef, payload }, session) => {
  const now = new Date().toISOString();
  const insertedId = await insert(
    {
      code: grantCode,
      clientRef,
      claimCode: payload.metadata.claimCode,
      clientClaimRef: payload.metadata.clientClaimRef,
      metadata: payload.metadata,
      claim: payload.claim,
      createdAt: now,
      updatedAt: now,
    },
    session,
  );

  if (insertedId === duplicateClientClaimRef) {
    return { created: false };
  }

  return { created: true, claimId: insertedId.toString() };
};

const maximumClaimsFor = (template) =>
  template.claim?.limits?.maximumClaims ?? 1;

const submitNewClaim = async (
  { grantCode, clientRef, payload, application },
  session,
) => {
  const template = await resolveClaimTemplate(
    grantCode,
    application,
    payload.metadata.claimCode,
  );
  const replay = await existingClaimResult(
    {
      code: grantCode,
      clientRef,
      clientClaimRef: payload.metadata.clientClaimRef,
    },
    session,
  );

  if (replay) {
    return replay;
  }

  assertApplicationIsClaimable(application, template);
  await assertUnderClaimLimit(
    {
      code: grantCode,
      clientRef,
      claimCode: payload.metadata.claimCode,
      maximumClaims: maximumClaimsFor(template),
    },
    session,
  );

  return persistNewClaim({ grantCode, clientRef, payload }, session);
};

const submitClaimInTransaction = async (
  { grantCode, clientRef, payload },
  session,
) => {
  const application = await lockAndLoadApplication(
    grantCode,
    clientRef,
    session,
  );

  return submitNewClaim(
    { grantCode, clientRef, payload, application },
    session,
  );
};

export const submitClaimUseCase = async ({ grantCode, clientRef, payload }) => {
  logger.info(
    `Submitting claim ${payload.metadata.clientClaimRef} for grant ${grantCode} and clientRef ${clientRef}`,
  );

  assertPathMatchesPayload(grantCode, clientRef, payload.metadata);

  const result = await withTransaction((session) =>
    submitClaimInTransaction({ grantCode, clientRef, payload }, session),
  );

  logger.info(
    `Finished: Submitting claim ${payload.metadata.clientClaimRef} for grant ${grantCode} and clientRef ${clientRef}`,
  );

  return result;
};
