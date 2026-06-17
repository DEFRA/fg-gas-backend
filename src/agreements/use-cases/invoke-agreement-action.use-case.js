import { withTransaction } from "../../common/with-transaction.js";
import { executeAgreementAction } from "./execute-agreement-action.use-case.js";
import { renderAgreementUseCase } from "./render-agreement.use-case.js";

const hasActionValidation = (error) => Boolean(error?.data?.validation);

const toErrorList = (fields = []) =>
  fields.map((field) => ({
    href: field.href,
    text: field.message,
  }));

const withFieldError = ({ action, fieldErrors }) => {
  const checkboxError = fieldErrors.find(
    (fieldError) => fieldError.name === action.checkbox?.name,
  );

  if (!checkboxError) {
    return action;
  }

  return {
    ...action,
    checkbox: {
      ...action.checkbox,
      errorMessage: {
        text: checkboxError.message,
      },
    },
  };
};

const withValidationErrors = ({ model, validation }) => ({
  ...model,
  actions: model.actions?.map((action) =>
    withFieldError({
      action,
      fieldErrors: validation.fields ?? [],
    }),
  ),
  errors: toErrorList(validation.fields),
});

const renderActionValidation = ({ agreementNumber, validation }) =>
  renderAgreementUseCase({
    agreementNumber,
    page: validation.page,
  }).then((model) => withValidationErrors({ model, validation }));

export const invokeAgreementActionUseCase = async ({
  actionName,
  agreementNumber,
  payload = {},
}) => {
  let result;

  try {
    result = await withTransaction(async (session) => {
      const result = await executeAgreementAction(
        {
          agreementNumber,
          actionName,
          payload,
        },
        session,
      );

      return result;
    });
  } catch (error) {
    if (!hasActionValidation(error)) {
      throw error;
    }

    return renderActionValidation({
      agreementNumber,
      validation: error.data.validation,
    });
  }

  return renderAgreementUseCase({
    agreementNumber: result.agreementNumber,
    page: result.status,
  });
};
