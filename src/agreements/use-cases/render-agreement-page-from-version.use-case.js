import Boom from "@hapi/boom";
import { logger } from "../../common/logger.js";
import {
  assertAgreementPageAllowedForStatus,
  resolveAgreementPageForVersion,
  resolveAgreementPageMode,
} from "../models/agreement-definitions/agreement-definition-resolver.js";
import { resolveComponents } from "../services/resolve-components.js";
import { resolveActions } from "../services/resolve-page-href.js";

const resolveRenderModel = async (
  pageDefinition,
  context,
  { page, agreementNumber },
) => {
  try {
    const [components, actions] = await Promise.all([
      resolveComponents(pageDefinition.components, context),
      resolveActions(context, pageDefinition.actions),
    ]);

    return { components, actions };
  } catch (error) {
    logger.error(
      error,
      `Failed to resolve render model for page "${page}" on agreement "${agreementNumber}"`,
    );
    throw Boom.badImplementation(
      `Unable to render page "${page}" for agreement "${agreementNumber}"`,
    );
  }
};

export const renderAgreementPageFromVersionUseCase = async ({
  currentAgreement,
  page,
  mode,
}) => {
  const { reference, version, item } = currentAgreement;
  const { snapshot } = version;
  const pageDefinition = resolveAgreementPageForVersion({
    code: reference.code,
    page,
    configVersion: item.configVersion,
  });
  resolveAgreementPageMode(mode);
  assertAgreementPageAllowedForStatus(
    reference.code,
    page,
    item.status,
    item.configVersion,
  );

  const context = { agreement: snapshot, snapshot, item };
  const { components, actions } = await resolveRenderModel(
    pageDefinition,
    context,
    { page, agreementNumber: reference.agreementNumber },
  );

  return {
    ...reference,
    status: item.status,
    page: { name: page, title: pageDefinition.title, mode },
    components,
    actions,
  };
};
