import { withTransaction } from "../../common/with-transaction.js";
import { executeAgreementAction } from "./execute-agreement-action.use-case.js";

const toActionResponse = (result) => ({
  agreementNumber: result.agreementNumber,
  code: result.code,
  clientRef: result.clientRef,
  status: result.status,
});

export const invokeAgreementActionUseCase = async ({
  actionName,
  agreementNumber,
  payload = {},
}) => {
  return withTransaction(async (session) => {
    const result = await executeAgreementAction(
      {
        agreementNumber,
        actionName,
        payload,
      },
      session,
    );

    return toActionResponse(result);
  });
};
