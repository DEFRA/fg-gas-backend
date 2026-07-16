import { logger } from "../../common/logger.js";
import { buildAgreementPageModel } from "../services/build-agreement-page-model.js";
import { assertCurrentAgreementReference } from "./assert-current-agreement-reference.js";
import { loadCurrentAgreementContext } from "./load-current-agreement-context.js";

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
  assertCurrentAgreementReference(currentAgreement, {
    agreementNumber,
    code,
    clientRef,
    sbi,
  });

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
