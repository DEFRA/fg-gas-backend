import {
  ListQueuesCommand,
  PurgeQueueCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { env } from "process";

const sqs = new SQSClient({
  region: env.AWS_REGION || "eu-west-2",
  endpoint: env.AWS_ENDPOINT_URL || "http://localhost:4567",
  credentials: {
    accessKeyId: "test",
    secretAccessKey: "test",
  },
});

const getQueueNames = (queueUrls) =>
  queueUrls.map((url) => url.split("/000000000000/").at(-1));

export const ensureQueues = async (queueUrls, attempt = 1) => {
  const maxRetries = 20;
  const delay = 3000;
  const queues = getQueueNames(queueUrls);

  const data = await sqs.send(
    new ListQueuesCommand({
      MaxResults: 1000,
    }),
  );

  const found = getQueueNames(data.QueueUrls || []);
  const allExist = queues.every((url) => found.includes(url));

  if (allExist) {
    return;
  }

  console.log(
    "\x1b[33m%s\x1b[0m",
    `Not all SQS queues are available yet. Attempt ${attempt} of ${maxRetries}. Retrying in ${
      delay / 1000
    } seconds...`,
  );

  if (attempt === maxRetries) {
    throw new Error(`SQS queues not available after ${maxRetries} attempts`);
  }

  await setTimeout(delay);
  return ensureQueues(queueUrls, attempt + 1);
};

export const sendMessage = async (queueUrl, message) =>
  sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(message),
      DelaySeconds: 0,
      MessageGroupId: randomUUID(),
    }),
  );

export const receiveMessages = async (queueUrl) => {
  const data = await sqs.send(
    new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 5,
    }),
  );

  if (!data.Messages) {
    return [];
  }

  return data.Messages.map((message) => JSON.parse(message.Body));
};

export const purgeQueue = async (queueUrl) =>
  sqs.send(
    new PurgeQueueCommand({
      QueueUrl: queueUrl,
    }),
  );

export const purgeQueues = async (queueUrls) =>
  Promise.all(queueUrls.map((url) => purgeQueue(url)));
