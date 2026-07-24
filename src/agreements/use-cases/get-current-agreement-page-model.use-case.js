import { logger } from "../../common/logger.js";
import { buildAgreementPageModel } from "../services/build-agreement-page-model.js";
import { loadCurrentAgreementContext } from "./load-current-agreement-context.js";

export const getCurrentAgreementPageModelUseCase = async ({
  agreementNumber,
  code,
  clientRef,
  sbi,
  mode = "view",
}) => {
  logger.info(
    { agreementNumber, code, clientRef, sbi, mode },
    "Getting current agreement page model",
  );

  const { agreement, agreementDefinition } = await loadCurrentAgreementContext({
    agreementNumber,
    code,
    clientRef,
    sbi,
  });
  const { pageId } = agreementDefinition.resolvePageForState(agreement.state);
  const pageModel = await buildAgreementPageModel({
    agreement,
    agreementDefinition,
    page: pageId,
    mode,
  });

  logger.info(
    `Rendered Agreement ${agreement.agreementNumber} version ${agreement.version}`,
  );
  return { agreement, pageModel };
};
