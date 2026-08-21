import Boom from "@hapi/boom";
import { logger } from "../../common/logger.js";
import { isMongoDuplicateKeyError } from "../../common/mongo-errors.js";
import { saveOutboxEvents } from "../../common/save-outbox-events.js";
import { withTransaction } from "../../common/with-transaction.js";
import { AgreementVersion } from "../models/agreement-version.js";
import {
  findAgreementByNumber,
  findVersionByIdempotencyKey,
  insertAgreementVersion,
  replaceCurrentAgreement,
} from "../repositories/agreement.repository.js";
import { applyActionValidation } from "../services/apply-action-validation.js";
import { buildAgreementPageModel } from "../services/build-agreement-page-model.js";
import { createOutboxMessages } from "../services/integrations/create-outbox-messages.js";
import { loadCurrentAgreementActionContext } from "./load-current-agreement-action-context.js";
import { loadCurrentAgreementContext } from "./load-current-agreement-context.js";
import { loadAgreementForAction } from "./load-current-agreement.js";

const currentAgreementLocation = "/agreements/current";

const staleError = (etag) => {
  const error = Boom.preconditionFailed("Agreement version is stale");
  error.output.headers.location = currentAgreementLocation;
  if (etag) {
    error.output.headers.etag = etag;
  }
  return error;
};

// Preserve the stale response even when its ETag cannot be rebuilt.
const staleEtag = async (agreement) => {
  try {
    const { etag } = await loadCurrentAgreementContext({ agreement });
    return etag;
  } catch (error) {
    logger.warn(
      error,
      `Could not build stale ETag for ${agreement.agreementNumber}`,
    );
    return null;
  }
};

const findCompleted = async (
  { agreementNumber, actionName, idempotencyKey },
  session,
) => {
  const version = await findVersionByIdempotencyKey(
    agreementNumber,
    idempotencyKey,
    session,
  );
  if (!version) {
    return null;
  }
  if (version.actionExecution.name !== actionName) {
    throw Boom.conflict("Idempotency key has already been used");
  }
  return { location: currentAgreementLocation };
};

// A Commit Operation is an opaque handle staged by the module that owns what it
// commits — Payments, today. It is handed the action's session and the facts
// only known once the transition is materialised, so what it writes commits
// with the Agreement, its Version and the lifecycle event, and rolls back
// together when anything before the commit fails. It returns the outbox
// publication to write alongside the rest, and the Claim ID the Agreement's own
// lifecycle event carries.
//
// Failures propagate unwrapped on purpose: a raced acceptance that beats the
// optimistic version check surfaces as a duplicate key error on the Payment's
// unique source index, and isConcurrentActionConflict below has to see it.
const runCommitOperation = ({ agreement, commitOperations }, session) => {
  const [operation] = commitOperations;

  if (!operation) {
    return null;
  }

  return operation.commit(
    {
      agreementNumber: agreement.agreementNumber,
      version: agreement.version,
      correlationId: agreement.correlationId,
    },
    session,
  );
};

const createLifecyclePublications = (current, next, claimId) =>
  current.state === next.state
    ? []
    : createOutboxMessages(["lifecycle"], next, claimId);

const createActionPublications = (current, next, commitResult) => {
  const lifecyclePublications = createLifecyclePublications(
    current,
    next,
    commitResult?.claimId,
  );

  return commitResult
    ? [...lifecyclePublications, commitResult.publication]
    : lifecyclePublications;
};

const concurrentUpdate = Symbol("concurrentUpdate");

const actionConflictIndexFields = ["version", "actionExecution.idempotencyKey"];

const hasActionConflictIndex = (keyPattern) =>
  actionConflictIndexFields.some((field) => Boolean(keyPattern?.[field]));

const hasAgreementNumberIndex = (keyPattern) =>
  Boolean(keyPattern?.agreementNumber);

// A raced acceptance normally loses the optimistic version check, but the
// Payment's unique source index is the backstop that guarantees one Payment per
// accepted Version even if it does not.
const hasPaymentSourceIndex = (keyPattern) =>
  Boolean(keyPattern?.["source.agreementNumber"]);

const isConcurrentActionConflict = (error) =>
  isMongoDuplicateKeyError(error) &&
  ((hasAgreementNumberIndex(error.keyPattern) &&
    hasActionConflictIndex(error.keyPattern)) ||
    hasPaymentSourceIndex(error.keyPattern));

const commitActionTransaction = async (
  { actionName, current, idempotencyKey, next },
  session,
) => {
  const completed = await findCompleted(
    {
      agreementNumber: current.agreementNumber,
      actionName,
      idempotencyKey,
    },
    session,
  );
  if (completed) {
    return completed;
  }

  const result = await replaceCurrentAgreement(
    next.agreement,
    current.version,
    session,
  );
  if (result.modifiedCount !== 1) {
    return concurrentUpdate;
  }
  await insertAgreementVersion(
    new AgreementVersion({
      agreementNumber: current.agreementNumber,
      version: next.agreement.version,
      snapshot: next.agreement,
      versionedAt: next.agreement.updatedAt,
      actionExecution: { name: actionName, idempotencyKey },
    }),
    session,
  );
  const commitResult = await runCommitOperation(next, session);
  await saveOutboxEvents(
    createActionPublications(current, next.agreement, commitResult),
    session,
  );

  return { location: currentAgreementLocation };
};

const resolveConcurrentUpdate = async (options) => {
  const completed = await findCompleted(options);
  if (completed) {
    return completed;
  }

  const agreement = await findAgreementByNumber(options.agreementNumber);
  if (!agreement) {
    throw Boom.notFound("Agreement not found");
  }
  throw staleError(await staleEtag(agreement));
};

const toConcurrentOptions = (options) => ({
  agreementNumber: options.current.agreementNumber,
  actionName: options.actionName,
  idempotencyKey: options.idempotencyKey,
});

export const commitAgreementAction = async (options) => {
  let result;

  try {
    result = await withTransaction((session) =>
      commitActionTransaction(options, session),
    );
  } catch (error) {
    if (!isConcurrentActionConflict(error)) {
      throw error;
    }
    return resolveConcurrentUpdate(toConcurrentOptions(options));
  }

  return result === concurrentUpdate
    ? resolveConcurrentUpdate(toConcurrentOptions(options))
    : result;
};

export const executeAgreementActionUseCase = async (options) => {
  const authorisedAgreement = await loadAgreementForAction(options);
  const completed = await findCompleted(options);
  if (completed) {
    return completed;
  }

  const { action, agreement, agreementDefinition, etag } =
    await loadCurrentAgreementActionContext({
      ...options,
      agreement: authorisedAgreement,
    });
  if (options.ifMatch !== etag) {
    throw staleError(etag);
  }
  const validation = action.validate(options.values);
  if (!validation.valid) {
    const pageModel = await buildAgreementPageModel({
      agreement,
      agreementDefinition,
      page: validation.page,
      mode: "view",
    });
    return {
      ...applyActionValidation({
        pageModel,
        values: options.values,
        errors: validation.errors,
      }),
      etag,
    };
  }

  const next = await agreementDefinition.executeAction({
    agreement,
    actionName: options.actionName,
    values: options.values,
    execution: {
      correlationId: agreement.correlationId,
      executedAt: new Date().toISOString(),
    },
  });
  return commitAgreementAction({
    actionName: options.actionName,
    current: agreement,
    idempotencyKey: options.idempotencyKey,
    next,
  });
};
