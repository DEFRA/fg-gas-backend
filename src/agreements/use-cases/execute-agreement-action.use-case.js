import Boom from "@hapi/boom";
import { isMongoDuplicateKeyError } from "../../common/mongo-errors.js";
import { saveOutboxEvents } from "../../common/save-outbox-events.js";
import { withTransaction } from "../../common/with-transaction.js";
import { createAgreementPaymentUseCase } from "../../payments/use-cases/create-agreement-payment.use-case.js";
import { AgreementVersion } from "../models/agreement-version.js";
import {
  findAgreementByNumber,
  findVersionByIdempotencyKey,
  insertAgreementVersion,
  replaceCurrentAgreement,
} from "../repositories/agreement.repository.js";
import { applyActionValidation } from "../services/apply-action-validation.js";
import { buildAgreementPageModel } from "../services/build-agreement-page-model.js";
import { createOutboxMessages } from "../services/effects/create-outbox-messages.js";
import { loadCurrentAgreementActionContext } from "./load-current-agreement-action-context.js";
import { loadCurrentAgreementContext } from "./load-current-agreement-context.js";
import { loadAgreementForAction } from "./load-current-agreement.js";

const currentAgreementLocation = "/agreements/current";

const staleError = (etag) => {
  const error = Boom.preconditionFailed("Agreement version is stale");
  error.output.headers.location = currentAgreementLocation;
  error.output.headers.etag = etag;
  return error;
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

const findPaymentRequest = (commitOperations) => {
  let paymentOperationCount = 0;
  let paymentRequest;

  for (const operation of commitOperations) {
    if (operation.type !== "create-agreement-payment") {
      throw Boom.badImplementation(
        `Unsupported Agreement Action commit operation "${operation.type}"`,
      );
    }
    paymentOperationCount += 1;
    if (paymentOperationCount > 1) {
      throw Boom.badImplementation(
        "Agreement Action cannot create more than one Payment",
      );
    }
    paymentRequest = operation.request;
  }

  return paymentRequest;
};

// Payments owns the claim ID, the Payment document and the message that carries
// it to the Payment Service; it is handed the action's session so all of them
// commit with the Agreement, its Version and the lifecycle event, and roll back
// together when anything before the commit fails. The Payment Service
// publication comes back to be written to the outbox with the rest.
const createAgreementPayment = async (
  { agreement, commitOperations },
  session,
) => {
  const paymentRequest = findPaymentRequest(commitOperations);

  if (!paymentRequest) {
    return null;
  }

  return createAgreementPaymentUseCase(
    {
      agreementNumber: agreement.agreementNumber,
      version: agreement.version,
      sbi: agreement.identifiers?.sbi,
      frn: agreement.identifiers?.frn,
      agreementCorrelationId: agreement.correlationId,
      ...paymentRequest,
    },
    session,
  );
};
const createLifecyclePublications = (current, next, payment) =>
  current.state === next.state
    ? []
    : createOutboxMessages(["lifecycle"], next, payment);

const createActionPublications = (current, next, paymentResult) => {
  const lifecyclePublications = createLifecyclePublications(
    current,
    next,
    paymentResult?.payment,
  );

  return paymentResult
    ? [...lifecyclePublications, paymentResult.publication]
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
  const paymentResult = await createAgreementPayment(next, session);
  await saveOutboxEvents(
    createActionPublications(current, next.agreement, paymentResult),
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
  const { etag } = await loadCurrentAgreementContext({ agreement });
  throw staleError(etag);
};

const toConcurrentOptions = (options) => ({
  agreementNumber: options.current.agreementNumber,
  actionName: options.actionName,
  idempotencyKey: options.idempotencyKey,
});

const commitAction = async (options) => {
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
  return commitAction({
    actionName: options.actionName,
    current: agreement,
    idempotencyKey: options.idempotencyKey,
    next,
  });
};
