import { logger } from "../../common/logger.js";
import { buildAgreementPageModel } from "../services/build-agreement-page-model.js";
import { loadCurrentAgreementContext } from "./load-current-agreement-context.js";

export const renderAgreementPageUseCase = async ({
  code,
  clientRef,
  sbi,
  page,
  mode,
}) => {
  logger.info(`Rendering page "${page}" (mode "${mode}") for code ${code}`);

  const { currentAgreement, agreementDefinition } =
    await loadCurrentAgreementContext({
      code,
      clientRef,
      sbi,
    });
  const pageModel = await buildAgreementPageModel({
    currentAgreement,
    agreementDefinition,
    page,
    mode,
  });

  logger.info(`Finished: Rendering page "${page}" for code ${code}`);

  return pageModel;
};
