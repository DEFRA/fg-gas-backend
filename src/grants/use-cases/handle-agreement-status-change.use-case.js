import Boom from "@hapi/boom";
import { acceptAgreementUseCase } from "./accept-agreement.use-case.js";

export const AgreementStatus = {
  Accepted: "accepted",
  Withdrawn: "withdrawn",
  Offered: "offered",
  Rejected: "rejected",
};

export const handleAgreementStatusChangeUseCase = async (command, session) => {
  const { eventData } = command;
  const { status } = eventData;

  if (status === AgreementStatus.Accepted) {
    await acceptAgreementUseCase(command, session);

    return;
  }

  throw Boom.badData(
    `Can not update agreement status. Unsupported agreement status "${status}"`,
  );
};
