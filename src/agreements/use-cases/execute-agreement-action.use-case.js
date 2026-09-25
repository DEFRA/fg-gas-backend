import Boom from "@hapi/boom";
import { logger } from "../../common/logger.js";
import { isMongoDuplicateKeyError } from "../../common/mongo-errors.js";
import { internalEventTarget, saveEvents } from "../../events/index.js";
import { withTransaction } from "../../common/with-transaction.js";
import { AgreementPaymentRequestedEvent } from "../events/agreement-payment-requested.event.js";
import { createAgreementStatusChangedReportingPublication } from "../events/agreement-reporting.event.js";
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

const hasPaymentCommitOperation = (commitOperations) => {
  const unsupported = commitOperations.find(
    ({ type }) => type !== "create-agreement-payment",
  );

  if (unsupported) {
    throw Boom.badImplementation(
      `Unsupported Agreement Action commit operation "${unsupported.type}"`,
    );
  }

  if (commitOperations.length > 1) {
    throw Boom.badImplementation(
      "Agreement Action cannot create more than one Payment",
    );
  }

  return commitOperations.length === 1;
};

const createLifecyclePublications = (current, next) =>
  current.state === next.state
    ? []
    : [
        ...createOutboxMessages(["lifecycle"], next),
        createAgreementStatusChangedReportingPublication(next),
      ];

const createActionPublications = (current, next, paymentRequested) => {
  const lifecyclePublications = createLifecyclePublications(current, next);
  if (!paymentRequested) {
    return lifecyclePublications;
  }

  const event = new AgreementPaymentRequestedEvent({
    agreement: next,
    executedAt: next.updatedAt,
  });
  return [
    ...lifecyclePublications,
    {
      event,
      target: internalEventTarget,
      segregationRef: next.agreementNumber,
    },
  ];
};

const concurrentUpdate = Symbol("concurrentUpdate");

const actionConflictIndexFields = ["version", "actionExecution.idempotencyKey"];

const hasActionConflictIndex = (keyPattern) =>
  actionConflictIndexFields.some((field) => Boolean(keyPattern?.[field]));

const hasAgreementNumberIndex = (keyPattern) =>
  Boolean(keyPattern?.agreementNumber);

const isConcurrentActionConflict = (error) =>
  isMongoDuplicateKeyError(error) &&
  hasAgreementNumberIndex(error.keyPattern) &&
  hasActionConflictIndex(error.keyPattern);

const commitActionTransaction = async (
  { actionName, current, idempotencyKey, next, paymentRequested },
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
  await saveEvents(
    createActionPublications(current, next.agreement, paymentRequested),
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
  const paymentRequested = hasPaymentCommitOperation(
    options.next.commitOperations,
  );
  let result;

  try {
    result = await withTransaction((session) =>
      commitActionTransaction({ ...options, paymentRequested }, session),
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

  const execution = {
    correlationId: agreement.correlationId,
    executedAt: new Date().toISOString(),
  };
  const next = await agreementDefinition.executeAction({
    agreement,
    actionName: options.actionName,
    values: options.values,
    execution,
  });
  return commitAgreementAction({
    actionName: options.actionName,
    current: agreement,
    idempotencyKey: options.idempotencyKey,
    next,
  });
};
