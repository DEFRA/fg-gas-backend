import { createAgreement } from "./create-agreement.use-case.js";
import { publishAgreementCreation } from "./publish-agreement-creation.use-case.js";

export const processCreateAgreementCommandUseCase = async (
  createAgreementCommand,
  session,
) => {
  const result = await createAgreement(createAgreementCommand.data, session);

  await publishAgreementCreation(result, session);

  return result;
};
