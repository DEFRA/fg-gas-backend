import {
  auditActions,
  auditEntities,
  auditStatus,
} from "../../events/audit-constants.js";
import { buildAuditEvent } from "../../events/with-audit.js";

const agreementDetails = (agreement) => ({
  sbi: agreement.identifiers?.sbi,
  frn: agreement.identifiers?.frn,
  crn: agreement.identifiers?.crn,
  agreementNumber: agreement.agreementNumber,
  clientRef: agreement.clientRef,
  code: agreement.code,
  version: agreement.version,
  state: agreement.state,
  correlationId: agreement.correlationId,
});

export const buildAgreementCreationAudit = (agreement) => ({
  ...buildAuditEvent({
    entity: auditEntities.AGREEMENT,
    action: auditActions.CREATE_AGREEMENT_RECORD,
    entityid: agreement.agreementNumber,
    details: agreementDetails(agreement),
    segregationRef: `agreement-${agreement.agreementNumber}`,
  }),
  status: auditStatus.SUCCESS,
});

export const buildAgreementViewAudit = (agreement, view, details = {}) =>
  buildAuditEvent({
    entity: auditEntities.AGREEMENT,
    action: auditActions.VIEW_AGREEMENT,
    entityid: agreement.agreementNumber,
    details: { ...agreementDetails(agreement), view, ...details },
    segregationRef: `agreement-${agreement.agreementNumber}`,
  });

const actionAuditClassification = (previous, next) =>
  next.state === "accepted" && previous.state !== "accepted"
    ? {
        action: auditActions.ACCEPT_AGREEMENT,
        pmccode: "0704",
        transactioncode: "2311",
        message: "Agreement accepted",
      }
    : {
        action: auditActions.UPDATE_AGREEMENT,
        pmccode: "0706",
        transactioncode: "2309",
        message: "Agreement updated",
      };

export const buildAgreementActionAudit = ({
  actionName,
  previous,
  next,
  status = auditStatus.SUCCESS,
  error,
}) => {
  const { action, pmccode, transactioncode, message } =
    actionAuditClassification(previous, next);

  return {
    ...buildAuditEvent({
      entity: auditEntities.AGREEMENT,
      action,
      entityid: next.agreementNumber,
      details: {
        ...agreementDetails(next),
        actionName,
        previousState: previous.state,
        ...(error && { error: error.message }),
      },
      security: {
        pmccode,
        priority: 0,
        details: {
          transactioncode,
          message,
          additionalinfo: `agreementNumber: ${next.agreementNumber}`,
        },
      },
      segregationRef: `agreement-${next.agreementNumber}`,
    }),
    status,
  };
};
