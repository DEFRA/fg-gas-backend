import Boom from "@hapi/boom";
import { withTransaction } from "../../common/with-transaction.js";
import { getAgreementDefinitionByCode } from "../models/agreement-definitions/index.js";
import { AgreementItem } from "../models/agreement-item.js";
import { generateAgreementNumber } from "../models/agreement-number.js";
import { AgreementVersion } from "../models/agreement-version.js";
import { Agreement } from "../models/agreement.js";
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
  const { target, effects = [] } = definition.create;

  const effectContext = await runAgreementEffects(effects, {
    answers,
    outputs: {},
    endpoints: definition.endpoints ?? [],
  });

  const snapshotItem = new AgreementItem({
    ...agreement.items[0],
    status: target,
    supplementaryData: effectContext.supplementaryData,
  });

  return AgreementVersion.new({
    agreementId: agreement.id,
    agreementNumber: agreement.agreementNumber,
    version: 1,
    snapshot: { ...agreement, items: [snapshotItem] },
  });
};

export const handleCreateAgreementCommand = async (event) => {
  const { clientRef, code, identifiers, answers } = event.data;

  const existingAgreement = await findByClientRefAndCode(clientRef, code);

  if (existingAgreement) {
    return existingAgreement;
  }

  const definition = getAgreementDefinitionByCode(code);

  if (!definition) {
    throw Boom.badRequest(`Unknown agreement code: "${code}"`);
  }

  const item = AgreementItem.create({
    agreementCode: code,
    clientRef,
    sourceSystem: SOURCE_SYSTEM,
    configVersion: definition.configVersion,
    identifiers,
    payload: answers,
    status: definition.create.target,
  });

  const agreement = Agreement.new({
    agreementNumber: generateAgreementNumber({
      prefix: definition.agreementNumberPrefix,
    }),
    code,
    identifiers,
    items: [item],
  });

  const version = await buildInitialVersion(definition, agreement, answers);

  return withTransaction(async (session) => {
    await saveAgreement(agreement, session);
    await saveVersion(version, session);

    return agreement;
  });
};
