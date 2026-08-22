import { MongoClient } from "mongodb";
import { env } from "node:process";
import { afterEach, beforeEach } from "vitest";
import { clearAgreementDefinitionCaches } from "../src/agreements/use-cases/load-agreement-definition.js";
import { clearPaymentDefinitionCaches } from "../src/payments/use-cases/load-payment-definition.js";
import { purgeQueues } from "./helpers/sqs";

let client;

beforeEach(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  const db = client.db();

  await Promise.all([
    db.collection("outbox").deleteMany({}),
    db.collection("inbox").deleteMany({}),
    db.collection("applications").deleteMany({}),
    db.collection("application_series").deleteMany({}),
    db.collection("grants").deleteMany({}),
    db.collection("config_versions").deleteMany({}),
    db.collection("users").deleteMany({}),
    db.collection("fifo_locks").deleteMany({}),
    db.collection("agreements__definitions").deleteMany({}),
    db.collection("payments__definitions").deleteMany({}),
    db.collection("entitlements").deleteMany({}),
  ]);

  // Clear module caches that survive database cleanup.
  clearAgreementDefinitionCaches();
  clearPaymentDefinitionCaches();

  await db.collection("config_versions").updateOne(
    { grantCode: "pigs-might-fly", version: "1.0.1" },
    {
      $set: {
        major: 1,
        minor: 0,
        patch: 1,
        status: "active",
        fetchStatus: "fetched",
        s3Key: "pigs-might-fly/1.0.0/gas/gas.json",
        s3Bucket: "config-broker-local",
        definitions: {
          agreement: {
            s3Key: "pigs-might-fly/1.0.0/gas/agreement.json",
            fetchStatus: "pending",
            fetchAttempts: 0,
            fetchError: null,
            fetchedAt: null,
            lastFetchAttemptAt: null,
          },
          payment: {
            s3Key: "pigs-might-fly/1.0.0/gas/payment.json",
            fetchStatus: "pending",
            fetchAttempts: 0,
            fetchError: null,
            fetchedAt: null,
            lastFetchAttemptAt: null,
          },
        },
      },
    },
    { upsert: true },
  );

  await purgeQueues([
    env.GAS__SQS__GRANT_APPLICATION_CREATED_QUEUE_URL,
    env.GAS__SQS__GRANT_APPLICATION_STATUS_UPDATED_QUEUE_URL,
    env.CW__SQS__CREATE_NEW_CASE_QUEUE_URL,
    env.GAS__SQS__UPDATE_STATUS_QUEUE_URL,
    env.CREATE_AGREEMENT_QUEUE_URL,
    env.CREATE_PAYMENT_QUEUE_URL,
  ]);
});

afterEach(async () => {
  await client?.close();
});
