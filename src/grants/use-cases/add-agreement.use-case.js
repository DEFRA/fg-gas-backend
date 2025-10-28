import { withTransaction } from "../../common/with-transaction.js";
import { Agreement } from "../models/agreement.js";
import { CaseStatus } from "../models/case-status.js";
import { publishApplicationStatusUpdated } from "../publishers/application-event.publisher.js";
import { publishUpdateCaseStatus } from "../publishers/case-event.publisher.js";
import { update } from "../repositories/application.repository.js";
import { findApplicationByClientRefAndCodeUseCase } from "./find-application-by-client-ref-and-code.use-case.js";

export const addAgreementUseCase = async ({
  clientRef,
  code,
  agreementRef,
  date,
}) => {
  await withTransaction(async (session) => {
    const application = await findApplicationByClientRefAndCodeUseCase(
      clientRef,
      code,
    );

    const oldStatus = application.getFullyQualifiedStatus();

    const agreement = Agreement.new({
      agreementRef,
      date,
    });

    application.addAgreement(agreement);

    await update(application);

    await publishApplicationStatusUpdated({
      clientRef,
      oldStatus,
      newStatus: application.getFullyQualifiedStatus(),
    });

    await publishUpdateCaseStatus({
      caseRef: clientRef,
      workflowCode: code,
      newStatus: CaseStatus.Review,
      targetNode: "agreements",
      data: application.getAgreementsData(),
    });
  });
};
