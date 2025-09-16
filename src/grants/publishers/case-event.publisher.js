import { config } from "../../common/config.js";
import { publish } from "../../common/sns-client.js";
import { CreateNewCaseCommand } from "../commands/create-new-case.command.js";
import { UpdateCaseStatusCommand } from "../commands/update-case-status.command.js";

export const publishCreateNewCase = async (application) => {
  const event = new CreateNewCaseCommand(application);
  await publish(config.sns.createNewCaseTopicArn, event);
};

export const publishUpdateCaseStatus = async ({
  newStatus,
  caseRef,
  workflowCode,
  data,
}) => {
  const event = new UpdateCaseStatusCommand({
    newStatus,
    caseRef,
    workflowCode,
    data,
  });
  await publish(config.sns.updateCaseStatusTopicArn, event);
};
