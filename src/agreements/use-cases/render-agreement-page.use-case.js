import { logger } from "../../common/logger.js";
import { renderAgreementPageFromVersionUseCase } from "./render-agreement-page-from-version.use-case.js";
import { resolveCurrentAgreementUseCase } from "./resolve-current-agreement.use-case.js";

export const renderAgreementPageUseCase = async ({
  code,
  clientRef,
  sbi,
  page,
  mode,
}) => {
  logger.info(`Rendering page "${page}" (mode "${mode}") for code ${code}`);

  const { reference, version } = await resolveCurrentAgreementUseCase({
    code,
    clientRef,
    sbi,
  });
  const renderModel = await renderAgreementPageFromVersionUseCase({
    version,
    reference,
    page,
    mode,
  });

  logger.info(`Finished: Rendering page "${page}" for code ${code}`);

  return renderModel;
};
