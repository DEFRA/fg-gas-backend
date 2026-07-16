import { withTransaction } from "../../common/with-transaction.js";
import { loadAgreementDefinition } from "../models/agreement-definitions/agreement-definition-loader.js";
import { AgreementItem } from "../models/agreement-item.js";
import { AgreementVersion } from "../models/agreement-version.js";
import {
  findByClientRefAndCode,
  saveAgreement,
  saveVersion,
} from "../repositories/agreement.repository.js";
import { runAgreementEffects } from "../services/effects/agreement-effect-runner.js";

const SOURCE_SYSTEM = "GAS";

// Runs create effects (which may include a real, non-idempotent external
// HTTP call via the callEndpoint effect) and builds version 1. Deliberately
// called before any transaction is opened: withTransaction retries its whole
// callback on transient errors, so any external side effect performed inside
// it would risk firing more than once for the same command.
const buildInitialVersion = async (definition, agreement, answers) => {
  const effectContext = await runAgreementEffects(
    definition.getCreationEffects(),
    {
      answers,
      outputs: {},
      endpoints: definition.getEndpoints(),
    },
  );

  const snapshotItem = new AgreementItem({
    ...agreement.items[0],
    supplementaryData: effectContext.supplementaryData,
  });

  return AgreementVersion.new({
    agreementId: agreement.id,
    agreementNumber: agreement.agreementNumber,
    version: 1,
    snapshot: { ...agreement, items: [snapshotItem] },
  });
};

export const handleCreateAgreementCommandUseCase = async (event) => {
  const { clientRef, code, identifiers, metadata, answers } = event.data;

  const existingAgreement = await findByClientRefAndCode(clientRef, code);

  if (existingAgreement) {
    return existingAgreement;
  }

  const definition = await loadAgreementDefinition({
    code,
    configVersion: metadata?.configVersion,
  });
  const agreement = definition.createAgreement({
    clientRef,
    sourceSystem: SOURCE_SYSTEM,
    identifiers,
    payload: answers,
  });

  const version = await buildInitialVersion(definition, agreement, answers);

  return withTransaction(async (session) => {
    await saveAgreement(agreement, session);
    await saveVersion(version, session);

    return agreement;
  });
};
