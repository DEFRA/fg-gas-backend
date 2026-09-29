import { logger } from "../../common/logger.js";
import {
  auditActions,
  auditEntities,
  auditStatus,
} from "../../events/audit-constants.js";
import { buildAuditEvent } from "../../events/with-audit.js";
import { writeAuditEvent } from "../../events/write-audit-event.js";

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

const acceptanceAuditClassification = {
  action: auditActions.ACCEPT_AGREEMENT_OFFER,
  pmccode: "0704",
  transactioncode: "2311",
  message: "Agreement accepted",
};

const updateAuditClassification = {
  action: auditActions.UPDATE_AGREEMENT,
  pmccode: "0706",
  transactioncode: "2309",
  message: "Agreement updated",
};

const isAcceptanceAttempt = (actionName, attempted) =>
  actionName === "accept" || attempted?.state === "accepted";

const actionAuditClassification = (actionName, current, attempted) =>
  isAcceptanceAttempt(actionName, attempted) && current.state !== "accepted"
    ? acceptanceAuditClassification
    : updateAuditClassification;

const failureDetails = (status, attempted) =>
  status === auditStatus.FAILURE
    ? {
        attemptedState: attempted?.state,
        attemptedVersion: attempted?.version,
      }
    : {};

const idempotencyDetails = (idempotencyKey) =>
  idempotencyKey ? { idempotencyKey } : {};

const errorDetails = (error) => (error ? { error: error.message } : {});

const persistedAgreement = (status, current, attempted) =>
  status === auditStatus.FAILURE ? current : attempted;

export const buildAgreementActionAudit = ({
  actionName,
  current,
  attempted,
  status = auditStatus.SUCCESS,
  error,
  idempotencyKey,
}) => {
  const { action, pmccode, transactioncode, message } =
    actionAuditClassification(actionName, current, attempted);
  const persisted = persistedAgreement(status, current, attempted);

  return {
    ...buildAuditEvent({
      entity: auditEntities.AGREEMENT,
      action,
      entityid: current.agreementNumber,
      details: {
        ...agreementDetails(persisted),
        actionName,
        previousState: current.state,
        ...failureDetails(status, attempted),
        ...idempotencyDetails(idempotencyKey),
        ...errorDetails(error),
      },
      security: {
        pmccode,
        priority: 0,
        details: {
          transactioncode,
          message,
          additionalinfo: `agreementNumber: ${current.agreementNumber}`,
        },
      },
      segregationRef: `agreement-${current.agreementNumber}`,
    }),
    status,
  };
};

export const recordAgreementActionFailure = async ({
  actionName,
  current,
  attempted,
  error,
  idempotencyKey,
}) => {
  try {
    await writeAuditEvent(
      buildAgreementActionAudit({
        actionName,
        current,
        attempted,
        status: auditStatus.FAILURE,
        error,
        idempotencyKey,
      }),
      null,
    );
  } catch (auditError) {
    logger.error(
      `Failed to record audit for Agreement ${current.agreementNumber} action ${actionName}: ${auditError.message}`,
    );
  }
};
