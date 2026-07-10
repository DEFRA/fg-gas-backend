import Boom from "@hapi/boom";
import { logger } from "../../common/logger.js";
import { resolveAgreementPage } from "../models/agreement-definitions/agreement-definition-resolver.js";
import { findByClientRefCodeAndSbi } from "../repositories/agreement.repository.js";
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

  const agreement = await findByClientRefCodeAndSbi(clientRef, code, sbi);

  const itemForCodeAndClientRef = agreement?.items.find(
    (item) => item.agreementCode === code && item.clientRef === clientRef,
  );

  if (!itemForCodeAndClientRef) {
    throw Boom.notFound(
      `Agreement not found for code "${code}", clientRef "${clientRef}" and sbi "${sbi}"`,
    );
  }

  const pageDefinition = resolveAgreementPage(
    agreement.code,
    itemForCodeAndClientRef.status,
  );
  const actions = await resolveActions({ agreement }, pageDefinition.actions);

  logger.info(`Finished: Finding current agreement for code ${code}`);

  return {
    agreementNumber: agreement.agreementNumber,
    code: agreement.code,
    clientRef,
    sbi,
    status: itemForCodeAndClientRef.status,
    page: { title: pageDefinition.title },
    components: pageDefinition.components,
    actions,
  };
};
