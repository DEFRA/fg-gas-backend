import Boom from "@hapi/boom";
import { logger } from "../../common/logger.js";
import { buildAgreementPageModel } from "../services/build-agreement-page-model.js";
import { loadCurrentAgreementContext } from "./load-current-agreement-context.js";

const requireMatchingAgreementNumber = (currentAgreement, agreementNumber) => {
  if (agreementNumber && currentAgreement.agreementNumber !== agreementNumber) {
    throw Boom.notFound("Agreement not found");
  }
};

export const getCurrentAgreementPageModelUseCase = async ({
  agreementNumber,
  code,
  clientRef,
  sbi,
  mode = "view",
}) => {
  logger.info(`Getting current agreement page model for code ${code}`);

  const { currentAgreement, agreementDefinition } =
    await loadCurrentAgreementContext({
      code,
      clientRef,
      sbi,
    });
  requireMatchingAgreementNumber(currentAgreement, agreementNumber);

  const { pageId } = agreementDefinition.resolvePageForState(
    currentAgreement.state,
  );
  const pageModel = await buildAgreementPageModel({
    currentAgreement,
    agreementDefinition,
    page: pageId,
    mode,
  });

  logger.info(
    `Finished: Getting current agreement page model for code ${code}`,
  );

  return pageModel;
};
