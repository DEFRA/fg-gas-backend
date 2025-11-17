import { MongoClient } from "mongodb";
import { randomUUID } from "node:crypto";
import { env } from "node:process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { submitApplication } from "../helpers/applications.js";
import { createGrant } from "../helpers/grants.js";
import { sendMessage } from "../helpers/sqs.js";

let applications;
let outbox;
let client;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  applications = client.db().collection("applications");
  outbox = client.db().collection("outbox");
});

afterAll(async () => {
  await client?.close();
});

describe("On CaseStatusUpdated", () => {
  it("approves an application when the case status is 'APPROVED'", async () => {
    const traceparent = "ts-001";
    await createGrant();

    const { clientRef, code } = await submitApplication(applications);

    await expect(applications).toHaveRecord({
      clientRef,
      code,
      currentStatus: "APPLICATION_RECEIVED",
    });

    await applications.updateOne(
      { clientRef },
      { $set: { currentStatus: "IN_REVIEW" } },
    );

    const messageId = randomUUID();
    await sendMessage(env.GAS__SQS__UPDATE_STATUS_QUEUE_URL, {
      id: messageId,
      traceparent,
      type: "fg.cw-backend.test.case.status.updated",
      source: "CW",
      data: {
        caseRef: clientRef,
        workflowCode: code,
        previousStatus: "IN_REVIEW",
        currentStatus: "PRE_AWARD:REVIEW_APPLICATION:AGREEMENT_GENERATING",
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 500)); // wait for inbox to pick up queue

    await expect(applications).toHaveRecord({
      clientRef,
      code,
      currentStatus: "AGREEMENT_GENERATING",
    });

    await expect(outbox).toHaveRecord({
      target: env.GAS__SNS__GRANT_APPLICATION_STATUS_UPDATED_TOPIC_ARN,
    });
    await expect(outbox).toHaveRecord({
      target: env.GAS__SNS__CREATE_AGREEMENT_TOPIC_ARN,
    });

    await expect(
      env.GAS__SQS__GRANT_APPLICATION_STATUS_UPDATED_QUEUE_URL,
    ).toHaveReceived({
      id: expect.any(String),
      type: "cloud.defra.local.fg-gas-backend.application.status.updated",
      traceparent,
      source: "fg-gas-backend",
      time: expect.any(String),
      specversion: "1.0",
      datacontenttype: "application/json",
      data: {
        clientRef,
        grantCode: "test-code-1",
        currentStatus: "PRE_AWARD:REVIEW_APPLICATION:AGREEMENT_GENERATING",
        previousStatus: "PRE_AWARD:REVIEW_APPLICATION:IN_REVIEW",
      },
    });

    await expect(env.CREATE_AGREEMENT_QUEUE_URL).toHaveReceived({
      id: expect.any(String),
      traceparent,
      type: "cloud.defra.local.fg-gas-backend.agreement.create",
      source: "fg-gas-backend",
      time: expect.any(String),
      specversion: "1.0",
      datacontenttype: "application/json",
      data: {
        clientRef,
        code,
        identifiers: {
          sbi: "1234567890",
          frn: "1234567890",
          crn: "1234567890",
          defraId: "1234567890",
        },
        answers: {
          question1: "test answer",
        },
      },
    });
  });
});
