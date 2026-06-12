import { agreementCreationOutcomes } from "../models/agreement-creation-result.js";
import { publishAgreementLifecycle } from "./publish-agreement-lifecycle.use-case.js";

export const publishAgreementCreation = async (creation, session) => {
  if (creation.outcome !== agreementCreationOutcomes.CREATED) {
    return;
  }

  await publishAgreementLifecycle(
    {
      agreement: creation.agreement,
      item: creation.item,
      version: creation.version,
    },
    session,
  );
};
