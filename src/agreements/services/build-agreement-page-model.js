import Boom from "@hapi/boom";
import { logger } from "../../common/logger.js";
import { assertSupportedAgreementPageMode } from "./assert-supported-agreement-page-mode.js";
import { resolveComponents } from "./resolve-components.js";
import { resolveActions } from "./resolve-page-href.js";

const resolvePageActions = (pageDefinition, context, mode) =>
  mode === "print" ? [] : resolveActions(context, pageDefinition.actions);

const resolvePageContent = async (pageDefinition, context, mode) =>
  Promise.all([
    resolveComponents(pageDefinition.components, context),
    resolvePageActions(pageDefinition, context, mode),
  ]);

const toAgreementSummary = ({
  agreementNumber,
  code,
  clientRef,
  identifiers: { sbi },
  state,
  version,
}) => ({
  agreementNumber,
  code,
  clientRef,
  identifiers: { sbi },
  state,
  version,
});

export const buildAgreementPageModel = async ({
  agreement,
  agreementDefinition,
  page,
  mode,
}) => {
  assertSupportedAgreementPageMode(mode);
  const pageDefinition = agreementDefinition.resolvePage(page);
  agreementDefinition.assertPageAllowed({ page, state: agreement.state });
  // "definition.templates" is exposed so page content can address template
  // content as "$.definition.templates.*" without the whole definition
  // entering the resolve context.
  const context = {
    agreement,
    definition: { templates: agreementDefinition.getTemplates() },
  };

  try {
    const [components, actions] = await resolvePageContent(
      pageDefinition,
      context,
      mode,
    );
    const layout = pageDefinition.layout
      ? { layout: pageDefinition.layout }
      : {};

    return {
      agreement: toAgreementSummary(agreement),
      page: { name: page, title: pageDefinition.title, ...layout },
      components,
      actions,
    };
  } catch (error) {
    logger.error(
      error,
      `Failed to build page model "${page}" for agreement "${agreement.agreementNumber}"`,
    );
    throw Boom.badImplementation(
      `Unable to build page model "${page}" for agreement "${agreement.agreementNumber}"`,
    );
  }
};
