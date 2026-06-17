import Boom from "@hapi/boom";
import { findAgreementWithLatestVersionBySourceIdentity } from "../repositories/agreement.repository.js";
import { invokeAgreementActionUseCase } from "./invoke-agreement-action.use-case.js";
import { renderAgreementRecord } from "./render-agreement.use-case.js";

const statusCodes = {
  noContent: 204,
};

const assertRecordFound = (record) => {
  if (!record) {
    throw Boom.notFound("Agreement not found");
  }
};

const assertSbiMatches = ({ actual, expected }) => {
  if (!expected || actual !== expected) {
    throw Boom.forbidden("Agreement not found for SBI");
  }
};

const findCurrentAgreementRecord = async ({ clientRef, code, sbi }) => {
  const record = await findAgreementWithLatestVersionBySourceIdentity({
    agreementCode: code,
    clientRef,
  });

  assertRecordFound(record);
  assertSbiMatches({ actual: record.agreement.sbi, expected: sbi });

  return record;
};

export const getCurrentAgreementUseCase = async ({
  clientRef,
  code,
  mode,
  sbi,
}) => {
  const record = await findCurrentAgreementRecord({ clientRef, code, sbi });

  return renderAgreementRecord({
    record,
    page: mode,
  });
};

export const postCurrentAgreementUseCase = async ({
  action,
  clientRef,
  code,
  formData = {},
  sbi,
}) => {
  const currentAction = action ?? "display-accept";
  const record = await findCurrentAgreementRecord({ clientRef, code, sbi });

  if (currentAction === "display-accept") {
    return renderAgreementRecord({
      record,
      page: "accept",
    });
  }

  if (currentAction !== "validate-accept-offer") {
    throw Boom.badRequest(`Unknown agreement action "${currentAction}"`);
  }

  const result = await invokeAgreementActionUseCase({
    actionName: "accept",
    agreementNumber: record.agreement.agreementNumber,
    payload: {
      ...formData,
      acceptedBy: formData.acceptedBy ?? "applicant",
      clientRef,
      code,
    },
  });

  if (result.errors?.length) {
    return result;
  }

  return { statusCode: statusCodes.noContent };
};
