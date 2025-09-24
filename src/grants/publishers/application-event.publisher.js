import { config } from "../../common/config.js";
import { publish } from "../../common/sns-client.js";
import { ApplicationCreatedEvent } from "../events/application-created.event.js";
import { ApplicationStatusUpdatedEvent } from "../events/application-status-updated.event.js";
import { CreateAgreementCommand } from "../events/create-agreement-command.event.js";

export const publishApplicationCreated = async (props) => {
  const event = new ApplicationCreatedEvent(props);
  await publish(config.sns.grantApplicationCreatedTopicArn, event);
};

export const publishApplicationStatusUpdated = async (props) => {
  const event = new ApplicationStatusUpdatedEvent(props);
  await publish(config.sns.grantApplicationStatusUpdatedTopicArn, event);
};

export const publishCreateAgreementCommand = async (props) => {
  const event = new CreateAgreementCommand(props);
  await publish(config.sns.createAgreementTopicArn, event);
};
