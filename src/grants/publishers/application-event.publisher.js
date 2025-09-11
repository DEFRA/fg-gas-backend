import { config } from "../../common/config.js";
import { publish } from "../../common/sns-client.js";
import { AgreementCreatedEvent } from "../events/agreement-created.event.js";
import { ApplicationApprovedEvent } from "../events/application-approved.event.js";
import { ApplicationCreatedEvent } from "../events/application-created.event.js";

export const publishApplicationCreated = async (application) => {
  const event = new ApplicationCreatedEvent(application);
  await publish(config.applicationCreatedTopic, event);
};

export const publishApplicationApproved = async (applicationApproved) => {
  const event = new ApplicationApprovedEvent(applicationApproved);
  await publish(config.sns.grantApplicationStatusUpdatedTopicArn, event);
};

export const publishGenerateAgreement = async (application) => {
  const event = new AgreementCreatedEvent(application);
  await publish(config.sqs.saveAgreementQueueUrl, event);
};
