import { logger } from "../../common/logger.js";
import { loadAgreementDefinition } from "../models/agreement-definitions/agreement-definition-loader.js";
import { buildAgreementPageModel } from "../services/build-agreement-page-model.js";
import { loadCurrentAgreement } from "./load-current-agreement.js";

export const getCurrentAgreementPageUseCase = async ({
  code,
  clientRef,
  sbi,
}) => {
  logger.info(`Getting current agreement page for code ${code}`);

  const currentAgreement = await loadCurrentAgreement({
    code,
    clientRef,
    sbi,
  });
  const agreementDefinition = await loadAgreementDefinition({
    code: currentAgreement.code,
    configVersion: currentAgreement.definitionVersion,
  });
  const { pageId } = agreementDefinition.resolvePageForState(
    currentAgreement.state,
  );
  const pageModel = await buildAgreementPageModel({
    currentAgreement,
    agreementDefinition,
    page: pageId,
    mode: "view",
  });

  logger.info(`Finished: Getting current agreement page for code ${code}`);

  return pageModel;
};
