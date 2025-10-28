import Boom from "@hapi/boom";
import { acceptAgreementUseCase } from "./accept-agreement.use-case.js";
import { addAgreementUseCase } from "./add-agreement.use-case.js";
import { withdrawAgreementUseCase } from "./withdraw-agreement.use-case.js";

export const AgreementStatus = {
  Accepted: "accepted",
  Withdrawn: "withdrawn",
  Offered: "offered",
  Rejected: "rejected",
};

export const handleAgreementStatusChangeUseCase = async (message) => {
  const {
    event: { data },
    source,
  } = message;

  if (data.status === AgreementStatus.Offered) {
    await addAgreementUseCase({
      clientRef: data.clientRef,
      code: data.code,
      agreementRef: data.agreementNumber,
      date: data.date,
      requestedStatus: AgreementStatus.Offered,
      source,
    });

    return;
  }

  if (data.status === AgreementStatus.Accepted) {
    await acceptAgreementUseCase({
      clientRef: data.clientRef,
      code: data.code,
      agreementRef: data.agreementNumber,
      date: data.date,
      requestedStatus: AgreementStatus.Accepted,
      source,
    });

    return;
  }

  if (data.status === AgreementStatus.Withdrawn) {
    await withdrawAgreementUseCase({
      clientRef: data.clientRef,
      code: data.code,
      agreementRef: data.agreementNumber,
      date: data.date,
      source,
    });
    return;
  }

  throw Boom.badData(`Unsupported agreement status "${data.status}"`);
};
