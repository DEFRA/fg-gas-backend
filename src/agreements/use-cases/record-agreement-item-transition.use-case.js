import Boom from "@hapi/boom";
import { AgreementVersion } from "../models/agreement-version.js";
import { insertAgreementVersion } from "../repositories/agreement.repository.js";

const assertExpectedStatus = ({ itemState, expectedStatus }) => {
  if (itemState?.status === expectedStatus) {
    return;
  }

  throw Boom.badRequest(`Agreement item is not ${expectedStatus}`);
};

export const recordAgreementItemTransition = async (
  {
    agreementItemId,
    changedAt,
    changedBy,
    changeType,
    createId,
    fromStatus,
    itemPatch,
    previousVersion,
    toStatus,
  },
  session,
) => {
  assertExpectedStatus({
    itemState: previousVersion.findItemState(agreementItemId),
    expectedStatus: fromStatus,
  });

  const version = AgreementVersion.transition({
    id: createId(),
    previousVersion,
    agreementItemId,
    status: toStatus,
    createdAt: changedAt,
    change: {
      type: changeType ?? toStatus,
      changedBy,
      fromStatus,
    },
    itemPatch,
  });

  await insertAgreementVersion(version, session);

  return version;
};
