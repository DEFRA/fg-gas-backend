import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { config } from "./config.js";
import { randomUUID } from "crypto";
import { getTraceId } from "@defra/hapi-tracing";

export const snsClient = new SNSClient({
  region: config.region,
  endpoint: config.awsEndpointUrl,
});

/**
 *
 * @param {string} topicArn
 * @param {JSON} message
 * @returns
 */
export const publish = async (topicArn, message) => {
  const event = {
    id: randomUUID(),
    source: config.serviceName,
    specVersion: "1.0",
    type: `cloud.defra.${config.env}.${config.serviceName}.application.created`,
    datacontenttype: "application/json",
    data: message,
    traceparent: getTraceId(),
  };

  return snsClient.send(
    new PublishCommand({
      Message: JSON.stringify(event),
      TopicArn: topicArn,
    }),
  );
};
