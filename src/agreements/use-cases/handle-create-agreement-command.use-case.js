import Boom from "@hapi/boom";
import { getAgreementDefinitionByCode } from "../models/agreement-definitions/index.js";
import { AgreementItem } from "../models/agreement-item.js";
import { generateAgreementNumber } from "../models/agreement-number.js";
import { Agreement } from "../models/agreement.js";
import {
  findByClientRefAndCode,
  saveAgreement,
} from "../repositories/agreement.repository.js";

const SOURCE_SYSTEM = "GAS";

export const handleCreateAgreementCommand = async (event, session) => {
  const { clientRef, code, identifiers, answers } = event.data;

  const existingAgreement = await findByClientRefAndCode(
    clientRef,
    code,
    session,
  );

  if (existingAgreement) {
    return existingAgreement;
  }

  const definition = getAgreementDefinitionByCode(code);

  if (!definition) {
    throw Boom.badRequest(`Unknown agreement code: "${code}"`);
  }

  const item = AgreementItem.new({
    agreementCode: code,
    clientRef,
    sourceSystem: SOURCE_SYSTEM,
    configVersion: definition.configVersion,
    identifiers,
    payload: answers,
  });

  const agreement = Agreement.new({
    agreementNumber: generateAgreementNumber({
      prefix: definition.agreementNumberPrefix,
    }),
    code,
    identifiers,
    items: [item],
  });

  await saveAgreement(agreement, session);

  return agreement;
};
