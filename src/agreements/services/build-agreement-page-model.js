import Boom from "@hapi/boom";
import { logger } from "../../common/logger.js";
import { assertSupportedAgreementPageMode } from "./assert-supported-agreement-page-mode.js";
import { resolveComponents } from "./resolve-components.js";
import { resolveActions } from "./resolve-page-href.js";
import { resolveCondition, resolveRefs } from "./resolve-refs.js";

const DOCUMENT_PAGE = "document";

const resolveLifecyclePageActions = (pageDefinition, context, mode) =>
  mode === "print" ? [] : resolveActions(context, pageDefinition.actions);

const resolvePageContent = async (
  pageDefinition,
  context,
  resolvePageActions,
) =>
  Promise.all([
    resolveComponents(pageDefinition.components, context),
    resolvePageActions(pageDefinition, context),
  ]);

const resolveSection = async (section, context) => {
  const scope = { context, row: undefined };

  if (
    section.condition !== undefined &&
    !(await resolveCondition(section.condition, scope))
  ) {
    return undefined;
  }

  const [title, components] = await Promise.all([
    resolveRefs(section.title, scope),
    resolveComponents(section.components, context),
  ]);

  return { id: section.id, title, components };
};

const resolveSections = async (sections = [], context) => {
  const resolved = await Promise.all(
    sections.map((section) => resolveSection(section, context)),
  );

  return resolved.filter(Boolean);
};

const resolveWatermark = async (watermark, context) => {
  if (watermark === undefined) {
    return undefined;
  }

  const [resolved] = await resolveComponents(
    [{ component: "watermark", ...watermark }],
    context,
  );

  if (resolved === undefined) {
    return undefined;
  }

  const { component: _component, ...properties } = resolved;

  return properties;
};

const omitUndefined = (value) =>
  Object.fromEntries(
    Object.entries(value).filter(([_key, item]) => item !== undefined),
  );

const buildPageMetadata = async (page, pageDefinition, context) => {
  const watermark = await resolveWatermark(pageDefinition.watermark, context);

  return omitUndefined({
    name: page,
    title: pageDefinition.title,
    layout: pageDefinition.layout,
    contents: pageDefinition.contents,
    print: pageDefinition.print,
    watermark,
  });
};

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

const buildPageModel = async ({
  agreement,
  agreementDefinition,
  page,
  resolvePageActions,
}) => {
  const pageDefinition = agreementDefinition.resolvePage(page);
  // "definition.templates" is exposed so page content can address template
  // content as "$.definition.templates.*" without the whole definition
  // entering the resolve context.
  const context = {
    agreement,
    definition: { templates: agreementDefinition.getTemplates() },
  };

  try {
    const [[components, actions], sections, pageMetadata] = await Promise.all([
      resolvePageContent(pageDefinition, context, resolvePageActions),
      resolveSections(pageDefinition.sections, context),
      buildPageMetadata(page, pageDefinition, context),
    ]);

    return {
      agreement: toAgreementSummary(agreement),
      page: pageMetadata,
      components,
      sections,
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

export const buildAgreementPageModel = async ({
  agreement,
  agreementDefinition,
  page,
  mode,
}) => {
  assertSupportedAgreementPageMode(mode);
  agreementDefinition.assertPageAllowed({ page, state: agreement.state });

  return buildPageModel({
    agreement,
    agreementDefinition,
    page,
    resolvePageActions: (pageDefinition, context) =>
      resolveLifecyclePageActions(pageDefinition, context, mode),
  });
};

export const buildAgreementDocumentPageModel = async ({
  agreement,
  agreementDefinition,
}) =>
  buildPageModel({
    agreement,
    agreementDefinition,
    page: DOCUMENT_PAGE,
    resolvePageActions: () => [],
  });
