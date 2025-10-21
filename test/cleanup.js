import { MongoClient } from "mongodb";
import { env } from "node:process";
import { afterEach, beforeEach } from "vitest";
import { purgeQueues } from "./helpers/sqs";

let client;

beforeEach(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  const db = client.db();

  await Promise.all([
    db.collection("outbox").deleteMany({}),
    db.collection("applications").deleteMany({}),
    db.collection("grants").deleteMany({}),
    db.collection("users").deleteMany({}),
  ]);

  await purgeQueues([
    env.GAS__SQS__GRANT_APPLICATION_CREATED_QUEUE_URL,
    env.GAS__SQS__GRANT_APPLICATION_STATUS_UPDATED_QUEUE_URL,
    env.CW__SQS__CREATE_NEW_CASE_QUEUE_URL,
    env.GAS__SQS__UPDATE_STATUS_QUEUE_URL,
    env.CREATE_AGREEMENT_QUEUE_URL,
  ]);
});

afterEach(async () => {
  await client?.close();
});
