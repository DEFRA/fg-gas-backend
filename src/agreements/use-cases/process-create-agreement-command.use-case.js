import { createAgreement } from "./create-agreement.use-case.js";
import { publishAgreementResult } from "./publish-agreement-result.use-case.js";

export const processCreateAgreementCommandUseCase = async (
  createAgreementCommand,
  session,
) => {
  const result = await createAgreement(createAgreementCommand.data, session);

  await publishAgreementResult(result, session);

  return result;
};
