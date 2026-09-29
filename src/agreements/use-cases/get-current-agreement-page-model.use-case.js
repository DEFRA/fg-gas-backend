import { logger } from "../../common/logger.js";
import { withAudit } from "../../events/with-audit.js";
import { buildAgreementViewAudit } from "../services/agreement-audit.js";
import { buildAgreementPageModel } from "../services/build-agreement-page-model.js";
import { loadCurrentAgreementContext } from "./load-current-agreement-context.js";

const getCurrentAgreementPageModel = async ({
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

  const { agreement, agreementDefinition, etag } =
    await loadCurrentAgreementContext({
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
    {
      agreementNumber: agreement.agreementNumber,
      version: agreement.version,
    },
    "Rendered current agreement page model",
  );
  return { agreement, pageModel, etag };
};

const auditCurrentView = (_args, result) =>
  result?.agreement ? buildAgreementViewAudit(result.agreement, "current") : null;

export const getCurrentAgreementPageModelUseCase = withAudit(
  getCurrentAgreementPageModel,
  auditCurrentView,
);
