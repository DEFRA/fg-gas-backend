import { logger } from "../../common/logger.js";
import { renderAgreementPageFromVersion } from "./render-agreement-page-from-version.use-case.js";
import { resolveCurrentAgreement } from "./resolve-current-agreement.use-case.js";

export const renderAgreementPageUseCase = async ({
  code,
  clientRef,
  sbi,
  page,
  mode,
}) => {
  logger.info(`Rendering page "${page}" (mode "${mode}") for code ${code}`);

  const { reference, version } = await resolveCurrentAgreement({
    code,
    clientRef,
    sbi,
  });
  const renderModel = await renderAgreementPageFromVersion({
    version,
    reference,
    page,
    mode,
  });

  logger.info(`Finished: Rendering page "${page}" for code ${code}`);

  return renderModel;
};
