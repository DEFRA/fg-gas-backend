import Boom from "@hapi/boom";
import { logger } from "../../common/logger.js";
import {
  assertAgreementPageAllowedForStatus,
  resolveAgreementPage,
  resolveAgreementPageMode,
} from "../models/agreement-definitions/agreement-definition-resolver.js";
import { resolveComponents } from "../services/resolve-components.js";
import { resolveActions } from "../services/resolve-page-href.js";

const requireSnapshotItem = (version, identity) => {
  const item = version.snapshot?.findItemForIdentity?.(identity);

  if (!item) {
    throw Boom.badImplementation(
      `Agreement "${identity.agreementNumber}" version "${version.version}" is inconsistent`,
    );
  }

  return item;
};

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

export const renderAgreementPageFromVersion = async ({
  version,
  identity,
  page,
  mode,
}) => {
  const { snapshot } = version;
  const item = requireSnapshotItem(version, identity);
  const pageDefinition = resolveAgreementPage(identity.code, page);
  resolveAgreementPageMode(mode);
  assertAgreementPageAllowedForStatus(identity.code, page, item.status);

  const context = { agreement: snapshot, snapshot, item };
  const { components, actions } = await resolveRenderModel(
    pageDefinition,
    context,
    { page, agreementNumber: identity.agreementNumber },
  );

  return {
    ...identity,
    status: item.status,
    page: { name: page, title: pageDefinition.title, mode },
    components,
    actions,
  };
};
