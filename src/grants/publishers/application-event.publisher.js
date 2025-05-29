import { config } from "../../common/config.js";
import { publish } from "../../common/sns-client.js";
import { ApplicationApprovedEvent } from "../events/application-approved.event.js";
import { ApplicationCreatedEvent } from "../events/application-created.event.js";

export const publishApplicationCreated = async (application) => {
  const event = new ApplicationCreatedEvent(application);
  await publish(config.applicationCreatedTopic, event);
};

export const publishApplicationApproved = async (application) => {
  const event = new ApplicationApprovedEvent(application);
  await publish(config.applicationApprovedTopic, event);
};
