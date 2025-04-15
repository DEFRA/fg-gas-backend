import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";

export const snsClient = new SNSClient({
  region: "eu-west-2",
  endpoint: "http://localstack:4566",
});

export const publish = (message, topicArn) => {
  return snsClient.send(
    new PublishCommand({ Message: message, TopicArn: topicArn }),
  );
};
