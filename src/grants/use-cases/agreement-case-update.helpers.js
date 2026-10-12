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
  const agreementData = getAgreementData(application, agreementNumber);

  return UpdateCaseStatusCommand.forPosition({
    caseRef: clientRef,
    workflowCode: code,
    configVersion: application.currentConfigVersion,
    position: application.position,
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
