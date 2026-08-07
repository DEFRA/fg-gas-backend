import { randomUUID } from "node:crypto";
import { isMongoDuplicateKeyError } from "../../common/mongo-errors.js";
import { saveOutboxEvents } from "../../common/save-outbox-events.js";
import { withTransaction } from "../../common/with-transaction.js";
import { loadAgreementDefinition } from "../models/agreement-definitions/agreement-definition-loader.js";
import { AgreementVersion } from "../models/agreement-version.js";
import { assembleCreationAgreementValues } from "../models/assemble-creation-agreement-values.js";
import {
  findAgreementBySourceIdentity,
  insertAgreementVersion,
  insertCurrentAgreement,
} from "../repositories/agreement.repository.js";
import { createOutboxMessages } from "../services/effects/create-outbox-messages.js";

const runCreationProcesses = async (definition, input, execution) => {
  const application = await definition.resolveApplication(input);
  const { outputs } = await definition.runProcesses({
    location: { type: "create" },
    context: { application, execution },
  });

  return assembleCreationAgreementValues({ application, outputs });
};

const createAgreement = async (event) => {
  const { clientRef, code, identifiers, metadata } = event.data;
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
  const execution = {
    correlationId: randomUUID(),
    executedAt: new Date().toISOString(),
  };
  const values = await runCreationProcesses(definition, event.data, execution);
  const agreement = definition.createAgreement({
    clientRef,
    correlationId: execution.correlationId,
    createdAt: execution.executedAt,
    identifiers,
    values,
  });
  const agreementVersion = AgreementVersion.create({
    agreement,
    versionedAt: agreement.createdAt,
  });
  const outboundEvents = createOutboxMessages(["lifecycle"], agreement);

  return withTransaction(async (session) => {
    await insertCurrentAgreement(agreement, session);
    await insertAgreementVersion(agreementVersion, session);
    await saveOutboxEvents(outboundEvents, session);

    return agreement;
  });
};

const hasSourceIdentityKey = (error) =>
  Boolean(error.keyPattern?.code && error.keyPattern?.clientRef);

const isSourceIdentityConflict = (error) =>
  isMongoDuplicateKeyError(error) && hasSourceIdentityKey(error);

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
