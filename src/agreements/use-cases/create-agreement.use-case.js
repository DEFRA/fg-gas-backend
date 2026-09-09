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

const createAgreement = async (input) => {
  const { clientRef, code, currentConfigVersion } = input;
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
    input,
    execution,
  });
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

const isSourceIdentityConflict = (error) =>
  isMongoDuplicateKeyError(error) && hasSourceIdentityKey(error);

// Owns the whole agreement creation operation so every caller shares identical
// behaviour: loading the agreement definition, building and persisting the
// Agreement with its version and outbox events, and collapsing concurrent
// duplicate requests onto the stored Agreement. The production message path and
// the QA test endpoint both map their own input into this single use case
// rather than reproducing the steps.
export const createAgreementUseCase = async (input) => {
  try {
    return await createAgreement(input);
  } catch (error) {
    if (!isSourceIdentityConflict(error)) {
      throw error;
    }

    const { clientRef, code } = input;
    return findAgreementBySourceIdentity({ clientRef, code });
  }
};
