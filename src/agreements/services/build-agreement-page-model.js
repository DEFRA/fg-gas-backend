import Boom from "@hapi/boom";
import { logger } from "../../common/logger.js";
import { assertSupportedAgreementPageMode } from "./assert-supported-agreement-page-mode.js";
import { resolveComponents } from "./resolve-components.js";
import { resolveActions } from "./resolve-page-href.js";

const resolvePageActions = (pageDefinition, context, mode) =>
  mode === "print" ? [] : resolveActions(context, pageDefinition.actions);

const resolvePageModel = async (
  pageDefinition,
  context,
  { page, agreementNumber, mode },
) => {
  try {
    const [components, actions] = await Promise.all([
      resolveComponents(pageDefinition.components, context),
      resolvePageActions(pageDefinition, context, mode),
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
    { page, agreementNumber: currentAgreement.agreementNumber, mode },
  );
  const layout = pageDefinition.layout ? { layout: pageDefinition.layout } : {};

  return {
    ...currentAgreement.reference,
    state: currentAgreement.state,
    version: currentAgreement.version.version,
    page: { name: page, title: pageDefinition.title, ...layout },
    components,
    actions,
  };
};
