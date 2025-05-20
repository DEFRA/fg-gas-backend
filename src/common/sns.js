import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { config } from "./config.js";
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
export const publish = async (topicArn, message, traceId) => {
  return snsClient.send(
    new PublishCommand({
      Message: JSON.stringify({ ...message, traceId: traceId || getTraceId() }),
      TopicArn: topicArn,
    }),
  );
};
