import Boom from "@hapi/boom";
import { logger } from "../../common/logger.js";
import { resolveCondition, resolveRefs } from "../../common/resolve-refs.js";
import { assertSupportedAgreementPageMode } from "./assert-supported-agreement-page-mode.js";
import { resolveComponents } from "./resolve-components.js";
import { resolvePageActions as bindPageActions } from "./resolve-page-actions.js";
import { resolveActions } from "./resolve-page-href.js";

const DOCUMENT_PAGE = "document";

const resolveLifecyclePageActions = (pageDefinition, context) =>
  resolveActions(context, pageDefinition.actions);

const removeNestedActionNodes = (component, remove) => {
  const children = remove(component.components);
  if (component.component === "form") {
    return children;
  }

  return children.length === 0 ? [] : [{ ...component, components: children }];
};

const removeActionNode = (component, remove) => {
  if (component.component === "button") {
    return [];
  }

  return Array.isArray(component.components)
    ? removeNestedActionNodes(component, remove)
    : [component];
};

const removeActionNodes = (components) =>
  components.flatMap((component) =>
    removeActionNode(component, removeActionNodes),
  );

const removePageActionNodes = (tree) => ({
  components: removeActionNodes(tree.components),
  sections: tree.sections.map((section) => ({
    ...section,
    components: removeActionNodes(section.components),
  })),
});

const withoutPageActions = (tree, removeActions) =>
  removeActions ? removePageActionNodes(tree) : tree;

const resolvePageContent = async (
  pageDefinition,
  context,
  resolvePageActions,
) =>
  Promise.all([
    resolveComponents(pageDefinition.components, context),
    resolvePageActions(pageDefinition, context),
  ]);

const resolveConditionalDefinition = async (definition, context, resolve) => {
  if (definition === undefined) {
    return undefined;
  }

  const { condition, ...content } = definition;
  const scope = { context };

  if (condition !== undefined && !(await resolveCondition(condition, scope))) {
    return undefined;
  }

  return resolve(content, scope);
};

const resolveSection = (section, context) =>
  resolveConditionalDefinition(section, context, async (content, scope) => {
    const { id, title, components } = content;
    const [resolvedTitle, resolvedComponents] = await Promise.all([
      resolveRefs(title, scope),
      resolveComponents(components, context),
    ]);

    return { id, title: resolvedTitle, components: resolvedComponents };
  });

const resolveSections = async (context, sections = []) => {
  const resolved = await Promise.all(
    sections.map((section) => resolveSection(section, context)),
  );

  return resolved.filter(Boolean);
};

const resolveWatermark = (watermarks, state) => {
  const text = watermarks?.[state];
  return text === undefined ? undefined : { text };
};

const omitUndefined = (value) =>
  Object.fromEntries(
    Object.entries(value).filter(([_key, item]) => item !== undefined),
  );

const buildPageMetadata = async (page, pageDefinition, context) => {
  const watermark = resolveWatermark(
    pageDefinition.watermarks,
    context.agreement.state,
  );

  return omitUndefined({
    name: page,
    title: pageDefinition.title,
    layout: pageDefinition.layout,
    contents: pageDefinition.contents,
    print: pageDefinition.print,
    watermark,
  });
};

const toApplicantSummary = ({ business, customer }) => ({
  business: { name: business.name },
  customer: {
    name: { first: customer.name.first, last: customer.name.last },
  },
});

const toAgreementSummary = ({
  agreementNumber,
  code,
  clientRef,
  identifiers: { sbi },
  state,
  version,
  applicant,
}) => ({
  agreementNumber,
  code,
  clientRef,
  identifiers: { sbi },
  state,
  version,
  ...(applicant && { applicant: toApplicantSummary(applicant) }),
});

const resolvePageSections = (includeSections, context, sections) =>
  includeSections ? resolveSections(context, sections) : undefined;

const withPageSections = (includeSections, sections) =>
  includeSections ? sections : undefined;

const buildPageModel = async ({
  agreement,
  agreementDefinition,
  includeSections = false,
  outputs,
  page,
  removeActions = false,
  resolvePageActions,
}) => {
  const pageDefinition = agreementDefinition.resolvePage(page);
  // "definition.templates" is exposed so page content can address template
  // content as "$.definition.templates.*" without the whole definition
  // entering the resolve context.
  const context = {
    agreement,
    definition: { templates: agreementDefinition.getTemplates() },
    outputs,
  };

  try {
    const [[components, actions], sections, pageMetadata] = await Promise.all([
      resolvePageContent(pageDefinition, context, resolvePageActions),
      resolvePageSections(includeSections, context, pageDefinition.sections),
      buildPageMetadata(page, pageDefinition, context),
    ]);
    const resolvedTree = withoutPageActions(
      bindPageActions({ components, sections, actions }),
      removeActions,
    );

    return omitUndefined({
      agreement: toAgreementSummary(agreement),
      page: pageMetadata,
      components: resolvedTree.components,
      sections: withPageSections(includeSections, resolvedTree.sections),
    });
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

const buildPageWithProcesses = async ({
  agreement,
  agreementDefinition,
  page,
  ...options
}) => {
  const { outputs } = await agreementDefinition.runPageProcesses({
    agreement,
    page,
    execution: {
      correlationId: agreement.correlationId,
      executedAt: new Date().toISOString(),
    },
  });

  return buildPageModel({
    agreement,
    agreementDefinition,
    outputs,
    page,
    ...options,
  });
};

export const buildAgreementPageModel = async ({
  agreement,
  agreementDefinition,
  page,
  mode,
}) => {
  assertSupportedAgreementPageMode(mode);
  agreementDefinition.assertPageAllowed({ page, state: agreement.state });

  return buildPageWithProcesses({
    agreement,
    agreementDefinition,
    page,
    removeActions: mode === "print",
    resolvePageActions: resolveLifecyclePageActions,
  });
};

export const buildAgreementDocumentPageModel = async ({
  agreement,
  agreementDefinition,
}) =>
  buildPageWithProcesses({
    agreement,
    agreementDefinition,
    includeSections: true,
    page: DOCUMENT_PAGE,
    resolvePageActions: () => [],
  });
