import { logger } from "../../common/logger.js";
import { buildAgreementDocumentPageModel } from "../services/build-agreement-page-model.js";
import { loadCurrentAgreementContext } from "./load-current-agreement-context.js";
import { loadAgreementDocument } from "./load-current-agreement.js";

export const getAgreementDocumentPageModelUseCase = async ({
  agreementNumber,
  access,
}) => {
  logger.info({ agreementNumber }, "Getting read-only agreement document");
  // The document has its own access check, so the Agreement is loaded here and
  // handed to the context for the Definition and the ETag. Deriving the ETag
  // here instead left this route free to drift from the three that share it.
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
