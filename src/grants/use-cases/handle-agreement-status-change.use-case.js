import { Boom } from "@hapi/boom";
import { withTransaction } from "../../common/with-transaction.js";
import { AgreementStatus } from "../models/agreement.js";
import { acceptAgreementUseCase } from "./accept-agreement.use-case.js";
import { addAgreementUseCase } from "./add-agreement.use-case.js";
import { withdrawAgreementUseCase } from "./withdraw-agreement.use-case.js";

export const handleAgreementStatusChangeUseCase = async (data) => {
  return withTransaction(async (session) => {
    if (data.status === AgreementStatus.Offered) {
      await addAgreementUseCase({
        clientRef: data.clientRef,
        code: data.code,
        agreementRef: data.agreementNumber,
        date: data.date,
      });

      return;
    }

    if (data.status === AgreementStatus.Accepted) {
      await acceptAgreementUseCase({
        clientRef: data.clientRef,
        code: data.code,
        agreementRef: data.agreementNumber,
        date: data.date,
      });

      return;
    }

    if (data.status === AgreementStatus.Withdrawn) {
      await withdrawAgreementUseCase({
        clientRef: data.clientRef,
        code: data.code,
        agreementRef: data.agreementNumber,
        date: data.date,
      });
      return;
    }

    throw Boom.badData(`Unsupported agreement status "${data.status}"`);
  });
};
