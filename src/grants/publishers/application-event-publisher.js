import { randomUUID } from "node:crypto";
import config from "../../common/config.js";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";

const snsClient = new SNSClient({
  region: config.region,
  endpoint: config.awsEndpointUrl,
});

export const publishApplicationCreated = async (application) => {
  const event = {
    id: randomUUID(),
    source: config.serviceName,
    specVersion: "1.0",
    type: `cloud.defra.${config.env}.${config.serviceName}.application.created`,
    datacontenttype: "application/json",
    data: application, // TODO: map to event schema
  };

  await snsClient.send(
    new PublishCommand({
      Message: JSON.stringify(event),
      TopicArn: config.grantApplicationCreatedTopic,
    }),
  );
};

export const publishApplicationApproved = async (application) => {
  const event = {
    id: randomUUID(),
    source: config.serviceName,
    specVersion: "1.0",
    type: `cloud.defra.${config.env}.${config.serviceName}.application.approved`,
    datacontenttype: "application/json",
    data: application, // TODO: map to event schema
  };

  await snsClient.send(
    new PublishCommand({
      Message: JSON.stringify(event),
      TopicArn: config.grantApplicationApprovedTopic,
    }),
  );
};
