import { logger } from "../../common/logger.js";
import { buildAgreementDocumentPageModel } from "../services/build-agreement-page-model.js";
import { toEtag } from "./agreement-etag.js";
import { loadDefinitionForAgreement } from "./load-agreement-definition.js";
import { loadAgreementDocument } from "./load-current-agreement.js";

export const getAgreementDocumentPageModelUseCase = async ({
  agreementNumber,
  access,
}) => {
  logger.info({ agreementNumber }, "Getting read-only agreement document");
  const agreement = await loadAgreementDocument({ agreementNumber, access });
  const agreementDefinition = await loadDefinitionForAgreement(agreement);
  const pageModel = await buildAgreementDocumentPageModel({
    agreement,
    agreementDefinition,
  });

  return {
    agreement,
    pageModel,
    etag: toEtag(agreement, agreementDefinition.configVersion),
  };
};
