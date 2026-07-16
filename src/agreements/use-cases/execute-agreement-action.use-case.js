import Boom from "@hapi/boom";
import { MongoServerError } from "mongodb";
import { withTransaction } from "../../common/with-transaction.js";
import { AgreementItem } from "../models/agreement-item.js";
import { AgreementVersion } from "../models/agreement-version.js";
import { Agreement } from "../models/agreement.js";
import {
  findVersionByActionIdempotencyKey,
  saveVersion,
} from "../repositories/agreement.repository.js";
import { buildAgreementPageModel } from "../services/build-agreement-page-model.js";
import { assertCurrentAgreementReference } from "./assert-current-agreement-reference.js";
import { resolveAgreementAction } from "./load-current-agreement-action-context.js";
import { loadCurrentAgreementContext } from "./load-current-agreement-context.js";

const transitionCurrentItem = ({ currentAgreement, target, executedAt }) =>
  currentAgreement.snapshot.items.map((item) => {
    if (item.agreementItemId !== currentAgreement.item.agreementItemId) {
      return item;
    }

    return new AgreementItem({
      ...item,
      state: target,
      supplementaryData: {
        ...item.supplementaryData,
        acceptedAt: executedAt,
      },
    });
  });

const buildNextVersion = ({
  currentAgreement,
  target,
  actionName,
  idempotencyKey,
}) => {
  const executedAt = new Date().toISOString();
  const snapshot = new Agreement({
    ...currentAgreement.snapshot,
    items: transitionCurrentItem({ currentAgreement, target, executedAt }),
    updatedAt: executedAt,
  });

  return AgreementVersion.new({
    agreementId: snapshot.id,
    agreementNumber: snapshot.agreementNumber,
    version: currentAgreement.versionNumber + 1,
    snapshot,
    actionExecution: { name: actionName, idempotencyKey },
  });
};

const buildLocation = ({ agreementNumber, code, clientRef, sbi }) => {
  const query = new URLSearchParams({ code, clientRef, sbi });

  return `/agreements/${agreementNumber}?${query}`;
};

const assertCurrentVersion = ({ currentAgreement, ifMatch, location }) => {
  const currentTag = `"${currentAgreement.agreementNumber}:${currentAgreement.versionNumber}"`;

  if (ifMatch !== currentTag) {
    const error = Boom.preconditionFailed("Agreement version is stale");
    error.output.headers.location = location;
    throw error;
  }
};

const findCompletedExecution = async ({
  actionName,
  reference,
  idempotencyKey,
  location,
  session,
  currentAgreement,
}) => {
  const version = await findVersionByActionIdempotencyKey(
    reference.agreementNumber,
    idempotencyKey,
    session,
  );

  if (!version) {
    return null;
  }

  assertCurrentAgreementReference(currentAgreement, reference);

  if (version.actionExecution.name !== actionName) {
    throw Boom.conflict("Idempotency key has already been used");
  }

  return { location };
};

const executeInTransaction = async ({
  actionName,
  reference,
  values,
  ifMatch,
  idempotencyKey,
  location,
  session,
}) => {
  const { currentAgreement, agreementDefinition } =
    await loadCurrentAgreementContext({ ...reference, session });
  assertCurrentAgreementReference(currentAgreement, reference);
  const completed = await findCompletedExecution({
    actionName,
    reference,
    idempotencyKey,
    location,
    session,
    currentAgreement,
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

  await saveVersion(
    buildNextVersion({
      currentAgreement,
      target: action.transition.target,
      actionName,
      idempotencyKey,
    }),
    session,
  );

  return { location };
};

const isVersionConflict = (error) =>
  error instanceof MongoServerError && error.code === 11000;

export const executeAgreementActionUseCase = async ({
  actionName,
  reference,
  values,
  ifMatch,
  idempotencyKey,
}) => {
  const location = buildLocation(reference);
  const options = {
    actionName,
    reference,
    values,
    ifMatch,
    idempotencyKey,
    location,
  };

  try {
    return await withTransaction((session) =>
      executeInTransaction({ ...options, session }),
    );
  } catch (error) {
    if (!isVersionConflict(error)) {
      throw error;
    }

    const { currentAgreement } = await loadCurrentAgreementContext(reference);
    const completed = await findCompletedExecution({
      ...options,
      currentAgreement,
    });

    if (completed) {
      return completed;
    }

    throw Boom.conflict("Agreement has already changed");
  }
};
