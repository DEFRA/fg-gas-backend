import { CaseStatus } from "../models/case-status.js";
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

  const previousStatus = application.getFullyQualifiedStatus();

  application.acceptAgreement(agreementRef, date);

  await update(application);

  await publishApplicationStatusUpdated({
    clientRef,
    code,
    previousStatus,
    currentStatus: application.getFullyQualifiedStatus(),
  });

  const agreement = application.getAgreement(agreementRef);

  await publishUpdateCaseStatus({
    caseRef: clientRef,
    workflowCode: code,
    newStatus: CaseStatus.OfferAccepted,
    data: {
      createdAt: date,
      agreementStatus: agreement.latestStatus,
      agreementRef: agreement.agreementRef,
    },
  });
};
