import { publishApplicationStatusUpdated } from "../publishers/application-event.publisher.js";
import { publishUpdateCaseStatus } from "../publishers/case-event.publisher.js";
import { update } from "../repositories/application.repository.js";
import { findApplicationByClientRefAndCodeUseCase } from "./find-application-by-client-ref-and-code.use-case.js";

export const withdrawAgreementUseCase = async ({
  clientRef,
  code,
  agreementRef,
  date,
}) => {
  const application = await findApplicationByClientRefAndCodeUseCase(
    clientRef,
    code,
  );

  const oldStatus = application.getFullyQualifiedStatus();

  application.withdrawAgreement(agreementRef, date);

  const newStatus = application.getFullyQualifiedStatus();

  const agreement = application.getAgreement(agreementRef);

  await update(application);

  await publishApplicationStatusUpdated({
    clientRef,
    oldStatus,
    newStatus,
  });

  await publishUpdateCaseStatus({
    caseRef: clientRef,
    workflowCode: code,
    newStatus,
    data: {
      createdAt: date,
      agreementStatus: agreement.status,
      agreementRef: agreement.agreementRef,
    },
  });
};
