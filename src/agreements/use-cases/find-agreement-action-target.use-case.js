import Boom from "@hapi/boom";
import { findAgreementWithLatestVersionByExternalItemIdentity } from "../repositories/agreement.repository.js";

const findAgreementItem = ({ agreement, agreementCode, clientRef }) =>
  agreement.items.find((item) =>
    item.matches({
      agreementCode,
      clientRef,
    }),
  );

const assertRecordFound = (record) => {
  if (record) {
    return;
  }

  throw Boom.notFound("Agreement item not found");
};

const assertItemFound = (item) => {
  if (item) {
    return;
  }

  throw Boom.notFound("Agreement item not found");
};

const assertVersionFound = (version) => {
  if (version) {
    return;
  }

  throw Boom.notFound("Agreement version not found");
};

const assertItemStateFound = (itemState) => {
  if (itemState) {
    return;
  }

  throw Boom.notFound("Agreement item state not found");
};

export const findAgreementActionTarget = async (
  { agreementNumber, code, clientRef },
  session,
) => {
  const record = await findAgreementWithLatestVersionByExternalItemIdentity(
    {
      agreementNumber,
      agreementCode: code,
      clientRef,
    },
    session,
  );

  assertRecordFound(record);

  const item = findAgreementItem({
    agreement: record.agreement,
    agreementCode: code,
    clientRef,
  });

  assertItemFound(item);
  assertVersionFound(record.version);

  const previousItemState = record.version.findItemState(item.agreementItemId);

  assertItemStateFound(previousItemState);

  return {
    agreement: record.agreement,
    item,
    previousItemState,
    previousVersion: record.version,
  };
};
