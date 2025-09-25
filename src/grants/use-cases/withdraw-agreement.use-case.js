import { CaseStatus } from "../models/case-status.js";
import { publishApplicationStatusUpdated } from "../publishers/application-event.publisher.js";
import { publishUpdateCaseStatusWithAgreementData } from "../publishers/case-event.publisher.js";
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

  const previousStatus = application.getFullyQualifiedStatus();

  application.withdrawAgreement(agreementRef, date);

  const agreement = application.getAgreement(agreementRef);

  await update(application);

  await publishApplicationStatusUpdated({
    clientRef,
    code,
    previousStatus,
    currentStatus: application.getFullyQualifiedStatus(),
  });

  await publishUpdateCaseStatusWithAgreementData({
    caseRef: clientRef,
    workflowCode: code,
    newStatus: CaseStatus.OfferWithdrawn,
    data: {
      createdAt: date,
      agreementStatus: agreement.latestStatus,
      agreementRef: agreement.agreementRef,
    },
  });
};
