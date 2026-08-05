import { logger } from "../../common/logger.js";
import { loadAgreementDefinition } from "../models/agreement-definitions/agreement-definition-loader.js";
import { buildAgreementDocumentPageModel } from "../services/build-agreement-page-model.js";
import { loadAgreementDocument } from "./load-current-agreement.js";

export const getAgreementDocumentPageModelUseCase = async ({
  agreementNumber,
  access,
}) => {
  logger.info({ agreementNumber }, "Getting read-only agreement document");
  const agreement = await loadAgreementDocument({ agreementNumber, access });
  const agreementDefinition = await loadAgreementDefinition({
    code: agreement.code,
    configVersion: agreement.configVersion,
  });
  const pageModel = await buildAgreementDocumentPageModel({
    agreement,
    agreementDefinition,
  });

  return { agreement, pageModel };
};
