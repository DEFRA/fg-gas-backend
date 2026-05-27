import { config } from "../../common/config.js";
import { UpdateCaseStatusCommand } from "../commands/update-case-status.command.js";
import { ApplicationStatusUpdatedEvent } from "../events/application-status-updated.event.js";
import { Outbox } from "../models/outbox.js";

export const getAgreementData = (application, agreementNumber) =>
  application
    .getAgreementsData()
    .find((agreement) => agreement.agreementRef === agreementNumber);

export const createAgreementCaseUpdateCommand = ({
  clientRef,
  code,
  application,
  agreementNumber,
}) => {
  const { currentStage, currentPhase } = application;
  const currentStatus = application.getFullyQualifiedStatus();
  const agreementData = getAgreementData(application, agreementNumber);

  return new UpdateCaseStatusCommand({
    caseRef: clientRef,
    workflowCode: code,
    newStatus: currentStatus,
    phase: currentPhase,
    stage: currentStage,
    dataType: "ARRAY",
    key: "agreementRef",
    targetNode: "agreements",
    data: agreementData,
  });
};

export const createApplicationStatusUpdatedEventData = ({
  clientRef,
  code,
  previousStatus,
  application,
}) =>
  new ApplicationStatusUpdatedEvent({
    clientRef,
    code,
    previousStatus,
    currentStatus: application.getFullyQualifiedStatus(),
  });

export const createAgreementCaseUpdateOutbox = (props) => {
  const statusCommand = createAgreementCaseUpdateCommand(props);

  return new Outbox({
    event: statusCommand,
    target: config.sns.updateCaseStatusTopicArn,
    segregationRef: Outbox.getSegregationRef(statusCommand),
  });
};

export const createApplicationStatusUpdatedOutbox = (props) => {
  const statusEvent = createApplicationStatusUpdatedEventData(props);

  return new Outbox({
    event: statusEvent,
    target: config.sns.grantApplicationStatusUpdatedTopicArn,
    segregationRef: Outbox.getSegregationRef(statusEvent),
  });
};
