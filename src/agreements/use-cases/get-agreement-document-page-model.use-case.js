import { logger } from "../../common/logger.js";
import { withAudit } from "../../events/with-audit.js";
import { buildAgreementViewAudit } from "../services/agreement-audit.js";
import { buildAgreementDocumentPageModel } from "../services/build-agreement-page-model.js";
import { loadCurrentAgreementContext } from "./load-current-agreement-context.js";
import { loadAgreementDocument } from "./load-current-agreement.js";

const getAgreementDocumentPageModel = async ({
  agreementNumber,
  access,
}) => {
  logger.info({ agreementNumber }, "Getting read-only agreement document");
  const agreement = await loadAgreementDocument({ agreementNumber, access });
  const { agreementDefinition, etag } = await loadCurrentAgreementContext({
    agreement,
  });
  const pageModel = await buildAgreementDocumentPageModel({
    agreement,
    agreementDefinition,
  });

  return { agreement, pageModel, etag };
};

const auditDocumentView = (_args, result) =>
  result?.agreement
    ? buildAgreementViewAudit(result.agreement, "document")
    : null;

export const getAgreementDocumentPageModelUseCase = withAudit(
  getAgreementDocumentPageModel,
  auditDocumentView,
);
