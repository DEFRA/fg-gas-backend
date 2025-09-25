import { MongoClient } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { submitApplication } from "../helpers/applications.js";
import { createGrant } from "../helpers/grants.js";
import { purgeQueue, sendMessage } from "../helpers/sqs.js";

let grants;
let applications;
let client;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  grants = client.db().collection("grants");
  applications = client.db().collection("applications");
});

afterAll(async () => {
  await client?.close();
});

describe("On CaseStatusUpdated", () => {
  beforeEach(async () => {
    await grants.deleteMany({});
    await applications.deleteMany({});
    await purgeQueue(env.GAS__SQS__UPDATE_STATUS_QUEUE_URL);
  });

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
  });
});
