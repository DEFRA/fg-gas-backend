import Boom from "@hapi/boom";
import { randomUUID } from "node:crypto";
import { isMongoDuplicateKeyError } from "../../common/mongo-errors.js";
import { saveOutboxEvents } from "../../common/save-outbox-events.js";
import { withTransaction } from "../../common/with-transaction.js";
import { createAgreementCreatedReportingPublication } from "../events/agreement-reporting.event.js";
import { AgreementVersion } from "../models/agreement-version.js";
import {
  findAgreementBySourceIdentity,
  insertAgreementVersion,
  insertCurrentAgreement,
} from "../repositories/agreement.repository.js";
import { createOutboxMessages } from "../services/integrations/create-outbox-messages.js";
import { loadAgreementDefinition } from "./load-agreement-definition.js";

const persistAgreement = async (agreement) => {
  const agreementVersion = AgreementVersion.create({
    agreement,
    versionedAt: agreement.createdAt,
  });
  const outboundEvents = [
    ...createOutboxMessages(["lifecycle"], agreement),
    createAgreementCreatedReportingPublication(agreement),
  ];

  return withTransaction(async (session) => {
    await insertCurrentAgreement(agreement, session);
    await insertAgreementVersion(agreementVersion, session);
    await saveOutboxEvents(outboundEvents, session);

    return agreement;
  });
};

const hasSourceIdentityKey = (error) =>
  Boolean(error.keyPattern?.code && error.keyPattern?.clientRef);

const hasAgreementNumberKey = (error) => Boolean(error.keyPattern?._id);

const isSourceIdentityConflict = (error) =>
  isMongoDuplicateKeyError(error) && hasSourceIdentityKey(error);

const isAgreementNumberConflict = (error) =>
  isMongoDuplicateKeyError(error) && hasAgreementNumberKey(error);

// A drawn agreement number is only checked for uniqueness by the insert's
// _id constraint, so a collision is retried here with a freshly generated
// number rather than failing the create outright. Only persistence is
// retried - the creation Processes and calculator calls that built the rest
// of the Agreement already ran once and don't depend on the number.
const MAX_AGREEMENT_NUMBER_ATTEMPTS = 5;

const agreementNumberExhaustedError = (cause) =>
  Boom.badImplementation(
    `Could not generate a unique agreement number after ${MAX_AGREEMENT_NUMBER_ATTEMPTS} attempts`,
    cause,
  );

const persistWithAgreementNumberRetry = async (definition, agreement) => {
  let candidate = agreement;
  let lastConflict;

  for (let attempt = 1; attempt <= MAX_AGREEMENT_NUMBER_ATTEMPTS; attempt++) {
    try {
      return await persistAgreement(candidate);
    } catch (error) {
      if (!isAgreementNumberConflict(error)) {
        throw error;
      }

      lastConflict = error;
      candidate = candidate.withAgreementNumber(
        definition.generateAgreementNumber(),
      );
    }
  }

  throw agreementNumberExhaustedError(lastConflict);
};

const createAgreement = async (event) => {
  const { clientRef, code, currentConfigVersion } = event.data;
  const existingAgreement = await findAgreementBySourceIdentity({
    clientRef,
    code,
  });

  if (existingAgreement) {
    return existingAgreement;
  }

  const definition = await loadAgreementDefinition({
    code,
    configVersion: currentConfigVersion,
    resolution: "creation",
  });
  const execution = {
    correlationId: randomUUID(),
    executedAt: new Date().toISOString(),
  };
  const agreement = await definition.createAgreement({
    input: event.data,
    execution,
  });

  return persistWithAgreementNumberRetry(definition, agreement);
};

const createAgreementWithSourceIdentityFallback = async (event) => {
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

export const handleCreateAgreementCommandUseCase =
  createAgreementWithSourceIdentityFallback;
