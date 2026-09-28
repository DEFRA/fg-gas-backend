import { config } from "../../common/config.js";
import { UpdateCaseStatusCommand } from "../commands/update-case-status.command.js";

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
    configVersion: application.currentConfigVersion,
    newStatus: currentStatus,
    phase: currentPhase,
    stage: currentStage,
    dataType: "ARRAY",
    key: "agreementRef",
    targetNode: "agreements",
    data: agreementData,
  });
};

export const createAgreementCaseUpdatePublication = (props) => ({
  event: createAgreementCaseUpdateCommand(props),
  target: config.sns.updateCaseStatusTopicArn,
});
