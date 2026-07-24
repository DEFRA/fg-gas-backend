import { MongoServerError } from "mongodb";
import { saveOutboxEvents } from "../../common/save-outbox-events.js";
import { withTransaction } from "../../common/with-transaction.js";
import { loadAgreementDefinition } from "../models/agreement-definitions/agreement-definition-loader.js";
import { AgreementVersion } from "../models/agreement-version.js";
import { Agreement } from "../models/agreement.js";
import {
  findAgreementBySourceIdentity,
  insertAgreementVersion,
  insertCurrentAgreement,
} from "../repositories/agreement.repository.js";
import { runAgreementEffects } from "../services/effects/agreement-effect-runner.js";
import { createOutboxMessages } from "../services/effects/create-outbox-messages.js";

const buildInitialAgreement = async (definition, agreement, answers) => {
  const effectContext = await runAgreementEffects(
    definition.getCreationEffects(),
    {
      agreement,
      answers,
      outputs: {},
      endpoints: definition.getEndpoints(),
      executedAt: agreement.createdAt,
      target: agreement.state,
      version: agreement.version,
    },
  );

  const resultingAgreement = new Agreement(effectContext.agreement);

  return {
    agreement: resultingAgreement,
    outboundEvents: createOutboxMessages(
      effectContext.outboxMessageTypes ?? [],
      resultingAgreement,
    ),
  };
};

const createAgreement = async (event) => {
  const { clientRef, code, identifiers, metadata, answers } = event.data;
  const existingAgreement = await findAgreementBySourceIdentity({
    clientRef,
    code,
  });

  if (existingAgreement) {
    return existingAgreement;
  }

  const definition = await loadAgreementDefinition({
    code,
    configVersion: metadata?.configVersion,
  });
  const initialAgreement = definition.createAgreement({
    clientRef,
    identifiers,
    payload: answers,
  });
  const { agreement, outboundEvents } = await buildInitialAgreement(
    definition,
    initialAgreement,
    answers,
  );
  const agreementVersion = AgreementVersion.create({
    agreement,
    versionedAt: agreement.createdAt,
  });

  return withTransaction(async (session) => {
    await insertCurrentAgreement(agreement, session);
    await insertAgreementVersion(agreementVersion, session);
    await saveOutboxEvents(outboundEvents, session);

    return agreement;
  });
};

const isDuplicateKeyError = (error) =>
  error instanceof MongoServerError && error.code === 11000;

const hasSourceIdentityKey = (error) =>
  Boolean(error.keyPattern?.code && error.keyPattern?.clientRef);

const isSourceIdentityConflict = (error) =>
  isDuplicateKeyError(error) && hasSourceIdentityKey(error);

export const handleCreateAgreementCommandUseCase = async (event) => {
  try {
    return await createAgreement(event);
  } catch (error) {
    if (!isSourceIdentityConflict(error)) {
      throw error;
    }

    const { clientRef, code } = event.data;
    return findAgreementBySourceIdentity({ clientRef, code });
  }
};
