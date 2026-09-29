import Boom from "@hapi/boom";
import { withAudit } from "../../events/with-audit.js";
import { buildAgreementViewAudit } from "../services/agreement-audit.js";
import { buildAgreementPageModel } from "../services/build-agreement-page-model.js";
import { loadCurrentAgreementActionContext } from "./load-current-agreement-action-context.js";
import { loadAgreementForAction } from "./load-current-agreement.js";

const prepareAgreementAction = async ({
  actionName,
  agreementNumber,
  access,
}) => {
  const authorisedAgreement = await loadAgreementForAction({
    agreementNumber,
    access,
  });
  const { action, agreement, agreementDefinition, etag } =
    await loadCurrentAgreementActionContext({
      actionName,
      agreement: authorisedAgreement,
      agreementNumber,
    });
  if (!action.preparationPage) {
    throw Boom.badImplementation(
      `Agreement action "${actionName}" has no configured preparation page`,
    );
  }

  const pageModel = await buildAgreementPageModel({
    agreement,
    agreementDefinition,
    page: action.preparationPage,
    mode: "view",
  });

  return { agreement, pageModel, etag };
};

const auditActionPreparation = ([{ actionName }], result) =>
  result?.agreement
    ? buildAgreementViewAudit(result.agreement, "action-preparation", {
        actionName,
      })
    : null;

export const prepareAgreementActionUseCase = withAudit(
  prepareAgreementAction,
  auditActionPreparation,
);
