import Boom from "@hapi/boom";
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
import {
  allocateNextSequence,
  ClaimIdCounter,
} from "../repositories/counter.repository.js";
import { insertPayable } from "../repositories/payable.repository.js";
import { applyActionValidation } from "../services/apply-action-validation.js";
import { buildAgreementPageModel } from "../services/build-agreement-page-model.js";
import { runAgreementEffects } from "../services/effects/agreement-effect-runner.js";
import { createOutboxMessages } from "../services/effects/create-outbox-messages.js";
import { formatClaimId } from "../services/payables/claim-id.js";
import { toEtag } from "./agreement-etag.js";
import { buildPayable } from "./build-payable.js";
import { loadCurrentAgreementActionContext } from "./load-current-agreement-action-context.js";

const toLocation = (agreementNumber) => `/agreements/${agreementNumber}`;

const staleError = (agreement) => {
  const error = Boom.preconditionFailed("Agreement version is stale");
  error.output.headers.location = toLocation(agreement.agreementNumber);
  error.output.headers.etag = toEtag(agreement);
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
  return { location: toLocation(agreementNumber) };
};

const runAction = async ({
  action,
  agreement,
  agreementDefinition,
  values,
}) => {
  const executedAt = new Date().toISOString();
  const context = await runAgreementEffects(action.effects, {
    agreement,
    values,
    outputs: {},
    endpoints: agreementDefinition.getEndpoints(),
    executedAt,
    target: action.transition.target,
  });

  const nextAgreement = agreement.transition({
    target: action.transition.target,
    transitionedAt: executedAt,
    changes: context.agreement,
  });

  return {
    agreement: nextAgreement,
    events: createOutboxMessages(
      context.outboxMessageTypes ?? [],
      nextAgreement,
    ),
    payableRequest: context.payableRequest,
  };
};

// Allocating the claim ID and inserting the Payable happen here so they commit
// with the Agreement, its Version and the lifecycle event, and roll back
// together when anything before the commit fails.
const createPayableForVersion = async (
  { agreement, payableRequest },
  session,
) => {
  const sequence = await allocateNextSequence(ClaimIdCounter, session);

  const payable = buildPayable({
    agreement,
    paymentHubClaimId: formatClaimId(sequence),
    ...payableRequest,
  });

  await insertPayable(payable, session);
};

const concurrentUpdate = Symbol("concurrentUpdate");

const actionConflictIndexFields = ["version", "actionExecution.idempotencyKey"];

const hasActionConflictIndex = (keyPattern) =>
  actionConflictIndexFields.some((field) => Boolean(keyPattern?.[field]));

const hasAgreementNumberIndex = (keyPattern) =>
  Boolean(keyPattern?.agreementNumber);

// A raced acceptance normally loses the optimistic version check, but the
// Payable's unique source index is the backstop that guarantees one Payable per
// accepted Version even if it does not.
const hasPayableSourceIndex = (keyPattern) =>
  Boolean(keyPattern?.["source.agreementNumber"]);

const isConcurrentActionConflict = (error) =>
  isMongoDuplicateKeyError(error) &&
  ((hasAgreementNumberIndex(error.keyPattern) &&
    hasActionConflictIndex(error.keyPattern)) ||
    hasPayableSourceIndex(error.keyPattern));

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
  await saveOutboxEvents(next.events, session);

  if (next.payableRequest) {
    await createPayableForVersion(next, session);
  }

  return { location: toLocation(current.agreementNumber) };
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
  throw staleError(agreement);
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
  const completed = await findCompleted(options);
  if (completed) {
    return completed;
  }

  const { action, agreement, agreementDefinition } =
    await loadCurrentAgreementActionContext(options);
  if (options.ifMatch !== toEtag(agreement)) {
    throw staleError(agreement);
  }
  const validation = action.validate(options.values);
  if (!validation.valid) {
    const pageModel = await buildAgreementPageModel({
      agreement,
      agreementDefinition,
      page: validation.page,
      mode: "view",
    });
    return applyActionValidation({
      pageModel,
      values: options.values,
      errors: validation.errors,
    });
  }

  const next = await runAction({
    action,
    agreement,
    agreementDefinition,
    values: options.values,
  });
  return commitAction({
    actionName: options.actionName,
    current: agreement,
    idempotencyKey: options.idempotencyKey,
    next,
  });
};
