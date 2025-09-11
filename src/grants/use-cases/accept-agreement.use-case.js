import { publishApplicationStatusUpdated } from "../publishers/application-event.publisher.js";
import { publishUpdateCaseStatus } from "../publishers/case-event.publisher.js";
import { update } from "../repositories/application.repository.js";
import { findApplicationByClientRefAndCodeUseCase } from "./find-application-by-client-ref-and-code.use-case.js";

export const acceptAgreementUseCase = async ({
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

  application.acceptAgreement(agreementRef, date);
  const agreement = application.getAgreement(agreementRef);

  const newStatus = application.getFullyQualifiedStatus();

  await update(application);

  await publishApplicationStatusUpdated({
    clientRef,
    oldStatus,
    newStatus,
  });

  await publishUpdateCaseStatus({
    newStatus,
    caseRef: clientRef,
    workflowCode: code,
    data: {
      createdAt: date,
      agreementStatus: agreement.status,
      agreementRef: agreement.agreementRef,
    },
  });
};
