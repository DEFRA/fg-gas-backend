import { MongoClient } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { submitApplication } from "../helpers/applications.js";
import { createGrant } from "../helpers/grants.js";
import { sendMessage } from "../helpers/sqs.js";

let applications;
let client;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  applications = client.db().collection("applications");
});

afterAll(async () => {
  await client?.close();
});

describe("On CaseStatusUpdated", () => {
  it("approves an application when the case status is 'APPROVED'", async () => {
    await createGrant();

    const { clientRef, code } = await submitApplication(applications);

    await expect(applications).toHaveRecord({
      clientRef,
      code,
      currentStatus: "RECEIVED",
    });

    await sendMessage(env.GAS__SQS__UPDATE_STATUS_QUEUE_URL, {
      data: {
        caseRef: clientRef,
        workflowCode: code,
        previousStatus: "NEW",
        currentStatus: "APPROVED",
      },
    });

    await expect(applications).toHaveRecord({
      clientRef,
      code,
      currentStatus: "APPROVED",
    });

    await expect(
      env.GAS__SQS__GRANT_APPLICATION_STATUS_UPDATED_QUEUE_URL,
    ).toHaveReceived({
      id: expect.any(String),
      type: "cloud.defra.development.fg-gas-backend.application.status.updated",
      source: "fg-gas-backend",
      time: expect.any(String),
      specversion: "1.0",
      datacontenttype: "application/json",
      data: {
        clientRef,
        grantCode: "test-code-1",
        currentStatus: "PRE_AWARD:ASSESSMENT:APPROVED",
        previousStatus: "PRE_AWARD:ASSESSMENT:RECEIVED",
      },
    });

    await expect(env.CREATE_AGREEMENT_QUEUE_URL).toHaveReceived({
      id: expect.any(String),
      type: "cloud.defra.development.fg-gas-backend.agreement.create",
      source: "fg-gas-backend",
      time: expect.any(String),
      specversion: "1.0",
      datacontenttype: "application/json",
      data: {
        clientRef,
        code,
        applicationData: {
          answers: {
            question1: "test answer",
          },
        },
      },
    });
  });
});
