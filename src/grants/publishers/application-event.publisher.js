import { config } from "../../common/config.js";
import { publish } from "../../common/sns-client.js";
import { ApplicationApprovedEvent } from "../events/application-approved.event.js";
import { ApplicationCreatedEvent } from "../events/application-created.event.js";
import { ApplicationStatusUpdatedEvent } from "../events/application-status-updated.event.js";

export const publishApplicationCreated = async (props) => {
  const event = new ApplicationCreatedEvent(props);
  await publish(config.sns.grantApplicationCreatedTopicArn, event);
};

export const publishApplicationApproved = async (application) => {
  const event = new ApplicationApprovedEvent(application);
  await publish(config.applicationApprovedTopic, event);
};

export const publishApplicationStatusUpdated = async (application) => {
  const event = new ApplicationStatusUpdatedEvent(application);
  await publish(config.sns.grantApplicationStatusUpdatedTopicArn, event);
};
