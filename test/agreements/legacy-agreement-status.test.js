import { MongoClient } from "mongodb";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { env } from "node:process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sendMessage } from "../helpers/sqs.js";

const code = "woodland";
const clientRef = "legacy-agreement-status-client";
const agreementNumber = "WMP123456789";
const agreementDate = "2026-07-21T12:00:00.000Z";
const caseworkingUpdateTarget =
  "arn:aws:sns:eu-west-2:000000000000:gas__sns__update_case_status_fifo.fifo";
const legacyGrantDefinition = {
  ...JSON.parse(
    readFileSync(
      new URL("../fixtures/wmp/woodland.json", import.meta.url),
      "utf8",
    ),
  ),
  version: "0.0.0",
};

const createApplication = () => ({
  currentPhase: "PHASE_PRE_AWARD",
  currentStage: "STAGE_REVIEWING_APPLICATION",
  currentStatus: "STATUS_AGREEMENT_GENERATING",
  clientRef,
  code,
  createdAt: agreementDate,
  updatedAt: agreementDate,
  submittedAt: agreementDate,
  identifiers: { sbi: "300000072" },
  phases: [],
  agreements: {},
});

describe("Legacy Agreement status updates", () => {
  let applications;
  let client;
  let grants;
  let outbox;

  const clearScenarioData = () =>
    Promise.all([
      applications.deleteMany({ clientRef, code }),
      grants.deleteMany({ code }),
      outbox.deleteMany({
        $or: [
          { "event.data.clientRef": clientRef },
          { "event.data.caseRef": clientRef },
          { "event.audit.details.clientRef": clientRef },
        ],
      }),
    ]);

  beforeAll(async () => {
    client = await MongoClient.connect(env.MONGO_URI);
    const database = client.db();
    applications = database.collection("applications");
    grants = database.collection("grants");
    outbox = database.collection("outbox");
  });

  beforeEach(async () => {
    await clearScenarioData();
    await grants.insertOne(structuredClone(legacyGrantDefinition));
    await applications.insertOne(createApplication());
  });

  afterAll(async () => {
    await clearScenarioData();
    await client?.close();
  });

  it("updates Grants and publishes the Caseworking status after an Agreement Service offer", async () => {
    await sendMessage(env.GAS__SQS__UPDATE_AGREEMENT_STATUS_QUEUE_URL, {
      id: randomUUID(),
      traceparent: "legacy-agreement-status-trace",
      type: "io.onsite.agreement.status.updated",
      source: "urn:service:agreement",
      data: {
        clientRef,
        code,
        agreementNumber,
        date: agreementDate,
        status: "offered",
      },
    });

    await expect(applications).toHaveRecord({
      clientRef,
      code,
      currentPhase: "PHASE_PRE_AWARD",
      currentStage: "STAGE_PREPARING_AGREEMENT",
      currentStatus: "STATUS_AGREEMENT_READY_FOR_APPLICANT",
      [`agreements.${agreementNumber}.latestStatus`]: "OFFERED",
    });
    await expect(outbox).toHaveRecord({
      target: caseworkingUpdateTarget,
      "event.type": "cloud.defra.local.fg-gas-backend.case.update.status",
      "event.data.caseRef": clientRef,
      "event.data.workflowCode": code,
      "event.data.newStatus":
        "PHASE_PRE_AWARD:STAGE_PREPARING_AGREEMENT:STATUS_AGREEMENT_READY_FOR_APPLICANT",
      "event.data.supplementaryData.targetNode": "agreements",
      "event.data.supplementaryData.data.agreementRef": agreementNumber,
    });
  });
});
