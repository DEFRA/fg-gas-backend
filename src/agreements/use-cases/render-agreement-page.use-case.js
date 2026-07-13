import Boom from "@hapi/boom";
import { logger } from "../../common/logger.js";
import {
  resolveAgreementPage,
  resolveAgreementPageMode,
} from "../models/agreement-definitions/agreement-definition-resolver.js";
import {
  findByClientRefCodeAndSbi,
  findLatestVersionByAgreementNumber,
} from "../repositories/agreement.repository.js";
import { resolveComponents } from "../services/resolve-components.js";
import { resolveActions } from "../services/resolve-page-href.js";

const requireMatchingItem = (items, code, clientRef, notFoundMessage) => {
  const item = (items ?? []).find(
    (candidate) =>
      candidate.agreementCode === code && candidate.clientRef === clientRef,
  );

  if (!item) {
    throw Boom.notFound(notFoundMessage);
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

export const renderAgreementPageUseCase = async ({
  code,
  clientRef,
  sbi,
  page,
  mode,
}) => {
  logger.info(`Rendering page "${page}" (mode "${mode}") for code ${code}`);

  const pageDefinition = resolveAgreementPage(code, page);
  resolveAgreementPageMode(mode);

  const agreement = await findByClientRefCodeAndSbi(clientRef, code, sbi);
  const item = requireMatchingItem(
    agreement?.items,
    code,
    clientRef,
    `Agreement not found for code "${code}", clientRef "${clientRef}" and sbi "${sbi}"`,
  );

  const version = await findLatestVersionByAgreementNumber(
    agreement.agreementNumber,
  );

  if (!version) {
    throw Boom.notFound(
      `No version snapshot found for agreement "${agreement.agreementNumber}"`,
    );
  }

  const snapshotItem = requireMatchingItem(
    version.snapshot.items,
    code,
    clientRef,
    `No version snapshot item found for agreement "${agreement.agreementNumber}", code "${code}" and clientRef "${clientRef}"`,
  );

  const context = { agreement, snapshot: version.snapshot, item: snapshotItem };

  const { components, actions } = await resolveRenderModel(
    pageDefinition,
    context,
    { page, agreementNumber: agreement.agreementNumber },
  );

  logger.info(`Finished: Rendering page "${page}" for code ${code}`);

  return {
    agreementNumber: agreement.agreementNumber,
    code: agreement.code,
    clientRef,
    sbi,
    status: item.status,
    page: { name: page, title: pageDefinition.title, mode },
    components,
    actions,
  };
};
