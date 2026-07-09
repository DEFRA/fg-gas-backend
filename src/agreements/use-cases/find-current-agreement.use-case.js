import Boom from "@hapi/boom";
import { logger } from "../../common/logger.js";
import { resolveAgreementPage } from "../models/agreement-definitions/agreement-definition-resolver.js";
import { findByCodeClientRefAndSbi } from "../repositories/agreement.repository.js";
import { resolvePageHref } from "../services/resolve-page-href.js";

const resolveActions = async (context, actions = []) =>
  Promise.all(
    actions.map(async (action) => ({
      text: action.text,
      href: await resolvePageHref(action.href, context),
    })),
  );

export const findCurrentAgreementUseCase = async ({ code, clientRef, sbi }) => {
  logger.info(`Finding current agreement for code ${code}`);

  const agreement = await findByCodeClientRefAndSbi(code, clientRef, sbi);

  if (!agreement) {
    throw Boom.notFound(
      `Agreement not found for code "${code}", clientRef "${clientRef}" and sbi "${sbi}"`,
    );
  }

  const [item] = agreement.items;
  const pageDefinition = resolveAgreementPage(agreement.code, item.status);
  const actions = await resolveActions({ agreement }, pageDefinition.actions);

  logger.info(`Finished: Finding current agreement for code ${code}`);

  return {
    agreementNumber: agreement.agreementNumber,
    code: agreement.code,
    clientRef,
    sbi,
    status: item.status,
    page: { title: pageDefinition.title },
    components: pageDefinition.components,
    actions,
  };
};
