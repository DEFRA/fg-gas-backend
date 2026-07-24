import Boom from "@hapi/boom";
import { MongoServerError } from "mongodb";
import { saveOutboxEvents } from "../../common/save-outbox-events.js";
import { withTransaction } from "../../common/with-transaction.js";
import { AgreementVersion } from "../models/agreement-version.js";
import { Agreement } from "../models/agreement.js";
import {
  findAgreementByNumber,
  findVersionByIdempotencyKey,
  insertAgreementVersion,
  replaceCurrentAgreement,
} from "../repositories/agreement.repository.js";
import { buildAgreementPageModel } from "../services/build-agreement-page-model.js";
import { runAgreementEffects } from "../services/effects/agreement-effect-runner.js";
import { createOutboxMessages } from "../services/effects/create-outbox-messages.js";
import { toEtag } from "./agreement-etag.js";
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
    version: agreement.version + 1,
  });

  const currentAgreement =
    agreement instanceof Agreement ? agreement : new Agreement(agreement);

  const nextAgreement = currentAgreement.transition({
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
  };
};

const concurrentUpdate = Symbol("concurrentUpdate");

const actionConflictIndexFields = ["version", "actionExecution.idempotencyKey"];

const hasActionConflictIndex = (keyPattern) =>
  actionConflictIndexFields.some((field) => Boolean(keyPattern?.[field]));

const isDuplicateKeyError = (error) =>
  error instanceof MongoServerError && error.code === 11000;

const hasAgreementNumberIndex = (keyPattern) =>
  Boolean(keyPattern?.agreementNumber);

const isConcurrentActionConflict = (error) =>
  isDuplicateKeyError(error) &&
  hasAgreementNumberIndex(error.keyPattern) &&
  hasActionConflictIndex(error.keyPattern);

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
  return { location: toLocation(current.agreementNumber) };
};

const resolveConcurrentUpdate = async (options) => {
  const completed = await findCompleted(options);
  if (completed) {
    return completed;
  }

  const agreement = await findAgreementByNumber(options.agreementNumber);
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
    return { ...pageModel, values: options.values, errors: validation.errors };
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
