import { config } from "../../common/config.js";
import { publish } from "../../common/sns-client.js";
import { CreateNewCaseEvent } from "../events/create-new-case.event.js";

export const publishCreateNewCase = async (application) => {
  const event = new CreateNewCaseEvent(application);
  await publish(config.sns.createNewCaseTopicArn, event);
};
