import Boom from "@hapi/boom";
import { config } from "../../common/config.js";
import { SqsSubscriber } from "../../common/sqs-subscriber.js";
import { acceptAgreementUseCase } from "../use-cases/accept-agreement.use-case.js";
import { addAgreementUseCase } from "../use-cases/add-agreement.use-case.js";
import { withdrawAgreementUseCase } from "../use-cases/withdraw-agreement.use-case.js";

export const AgreementStatus = {
  Accepted: "accepted",
  Withdrawn: "withdrawn",
  Offered: "created",
  Rejected: "rejected",
};

export const agreementStatusUpdatedSubscriber = new SqsSubscriber({
  queueUrl: config.sqs.updateAgreementStatusQueueUrl,
  async onMessage(message) {
    const { data } = message;

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
  },
});
