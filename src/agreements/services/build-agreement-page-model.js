import Boom from "@hapi/boom";
import { logger } from "../../common/logger.js";
import { assertSupportedAgreementPageMode } from "./assert-supported-agreement-page-mode.js";
import { resolveComponents } from "./resolve-components.js";
import { resolveActions } from "./resolve-page-href.js";

const resolvePageModel = async (
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
      `Failed to build page model "${page}" for agreement "${agreementNumber}"`,
    );
    throw Boom.badImplementation(
      `Unable to build page model "${page}" for agreement "${agreementNumber}"`,
    );
  }
};

export const buildAgreementPageModel = async ({
  currentAgreement,
  agreementDefinition,
  page,
  mode,
}) => {
  assertSupportedAgreementPageMode(mode);
  const pageDefinition = agreementDefinition.resolvePage(page);
  agreementDefinition.assertPageAllowed({
    page,
    state: currentAgreement.state,
  });

  const context = {
    agreement: currentAgreement.snapshot,
    snapshot: currentAgreement.snapshot,
    item: currentAgreement.item,
  };
  const { components, actions } = await resolvePageModel(
    pageDefinition,
    context,
    { page, agreementNumber: currentAgreement.agreementNumber },
  );

  return {
    ...currentAgreement.reference,
    state: currentAgreement.state,
    page: { name: page, title: pageDefinition.title, mode },
    components,
    actions,
  };
};
