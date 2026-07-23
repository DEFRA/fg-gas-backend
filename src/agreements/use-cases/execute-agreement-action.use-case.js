import Boom from "@hapi/boom";
import { MongoServerError } from "mongodb";
import { saveOutboxEvents } from "../../common/save-outbox-events.js";
import { withTransaction } from "../../common/with-transaction.js";
import { AgreementItem } from "../models/agreement-item.js";
import { AgreementVersion } from "../models/agreement-version.js";
import { Agreement } from "../models/agreement.js";
import {
  findVersionByActionIdempotencyKey,
  saveVersion,
} from "../repositories/agreement.repository.js";
import { buildAgreementPageModel } from "../services/build-agreement-page-model.js";
import { runAgreementEffects } from "../services/effects/agreement-effect-runner.js";
import { resolveAgreementAction } from "./load-current-agreement-action-context.js";
import { loadCurrentAgreementContext } from "./load-current-agreement-context.js";

const MONGO_DUPLICATE_KEY_ERROR = 11000;

const transitionCurrentItem = ({ currentAgreement, target, effectContext }) =>
  currentAgreement.snapshot.items.map((item) => {
    if (item.agreementItemId !== currentAgreement.item.agreementItemId) {
      return item;
    }

    return new AgreementItem({
      ...effectContext.item,
      state: target,
    });
  });

const buildNextVersion = ({
  currentAgreement,
  target,
  actionName,
  agreementItemId,
  idempotencyKey,
  effectContext,
  executedAt,
}) => {
  const snapshot = new Agreement({
    ...currentAgreement.snapshot,
    items: transitionCurrentItem({ currentAgreement, target, effectContext }),
    updatedAt: executedAt,
  });

  return AgreementVersion.new({
    agreementId: snapshot.id,
    agreementNumber: snapshot.agreementNumber,
    version: currentAgreement.versionNumber + 1,
    snapshot,
    actionExecution: { name: actionName, agreementItemId, idempotencyKey },
  });
};

const buildLocation = ({ agreementNumber, code, clientRef, sbi }) => {
  const query = new URLSearchParams({ code, clientRef, sbi });

  return `/agreements/${agreementNumber}?${query}`;
};

const createStaleVersionError = (location) => {
  const error = Boom.preconditionFailed("Agreement version is stale");
  error.output.headers.location = location;

  return error;
};

const assertCurrentVersion = ({ currentAgreement, ifMatch, location }) => {
  const currentTag = `"${currentAgreement.agreementNumber}:${currentAgreement.versionNumber}"`;

  if (ifMatch !== currentTag) {
    throw createStaleVersionError(location);
  }
};

const findCompletedExecution = async ({
  actionName,
  agreementNumber,
  agreementItemId,
  idempotencyKey,
  location,
  session,
}) => {
  const version = await findVersionByActionIdempotencyKey(
    agreementNumber,
    agreementItemId,
    idempotencyKey,
    session,
  );

  if (!version) {
    return null;
  }

  if (version.actionExecution.name !== actionName) {
    throw Boom.conflict("Idempotency key has already been used");
  }

  return { location };
};

const executeInTransaction = async ({
  actionName,
  agreementNumber,
  agreementItemId,
  values,
  ifMatch,
  idempotencyKey,
  session,
}) => {
  const { currentAgreement, agreementDefinition } =
    await loadCurrentAgreementContext({
      agreementNumber,
      agreementItemId,
      session,
    });
  const location = buildLocation(currentAgreement.reference);
  const completed = await findCompletedExecution({
    actionName,
    agreementNumber,
    agreementItemId,
    idempotencyKey,
    location,
    session,
  });

  if (completed) {
    return completed;
  }

  assertCurrentVersion({ currentAgreement, ifMatch, location });
  const action = resolveAgreementAction(agreementDefinition, {
    state: currentAgreement.state,
    action: actionName,
  });
  const validation = action.validate(values);

  if (!validation.valid) {
    const pageModel = await buildAgreementPageModel({
      currentAgreement,
      agreementDefinition,
      page: validation.page,
      mode: "view",
    });

    return { ...pageModel, values, errors: validation.errors };
  }

  const executedAt = new Date().toISOString();
  const version = currentAgreement.versionNumber + 1;
  const effectContext = await runAgreementEffects(action.effects, {
    agreement: currentAgreement.snapshot,
    item: currentAgreement.item,
    values,
    endpoints: agreementDefinition.getEndpoints(),
    executedAt,
    target: action.transition.target,
    version,
    outputs: {},
  });

  await saveVersion(
    buildNextVersion({
      currentAgreement,
      target: action.transition.target,
      actionName,
      agreementItemId,
      idempotencyKey,
      effectContext,
      executedAt,
    }),
    session,
  );
  await saveOutboxEvents(effectContext.outboundEvents ?? [], session);

  return { location };
};

const isDuplicateKeyError = (error) =>
  error instanceof MongoServerError && error.code === MONGO_DUPLICATE_KEY_ERROR;

const hasVersionKeyPattern = (error) =>
  ["agreementId", "version"].every((key) => error.keyPattern?.[key]);

const isVersionConflict = (error) =>
  isDuplicateKeyError(error) && hasVersionKeyPattern(error);

export const executeAgreementActionUseCase = async (options) => {
  try {
    return await withTransaction((session) =>
      executeInTransaction({ ...options, session }),
    );
  } catch (error) {
    if (!isVersionConflict(error)) {
      throw error;
    }

    const { currentAgreement } = await loadCurrentAgreementContext({
      agreementNumber: options.agreementNumber,
      agreementItemId: options.agreementItemId,
    });
    const location = buildLocation(currentAgreement.reference);
    const completed = await findCompletedExecution({
      ...options,
      location,
    });

    if (completed) {
      return completed;
    }

    throw createStaleVersionError(location);
  }
};
