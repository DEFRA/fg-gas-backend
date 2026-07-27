import { MongoClient } from "mongodb";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { env } from "node:process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sendMessage } from "../helpers/sqs.js";

const code = "pigs-might-fly";
const clientRef = "pmf-create-agreement-client";
const sbi = "300000071";
const caseworkingUpdateTarget =
  "arn:aws:sns:eu-west-2:000000000000:gas__sns__update_case_status_fifo.fifo";
const pmfGrantDefinition = JSON.parse(
  readFileSync(
    new URL("../fixtures/pmf-grant-definition.json", import.meta.url),
    "utf8",
  ),
);

const createApplication = () => {
  const createdAt = "2026-07-15T12:00:00.000Z";

  return {
    currentPhase: "PRE_AWARD",
    currentStage: "REVIEW_APPLICATION",
    currentStatus: "IN_REVIEW",
    clientRef,
    code,
    createdAt,
    updatedAt: createdAt,
    submittedAt: createdAt,
    identifiers: { sbi },
    metadata: { configVersion: "1.0.1" },
    phases: [
      {
        code: "PRE_AWARD",
        answers: {
          whitePigsCount: 5,
          britishLandracePigsCount: 0,
          berkshirePigsCount: 0,
          otherPigsCount: 0,
        },
      },
    ],
    agreements: {},
  };
};

describe("PMF Agreement creation", () => {
  let applications;
  let agreements;
  let client;
  let grants;
  let outbox;
  let versions;

  const clearScenarioData = () =>
    Promise.all([
      applications.deleteMany({ clientRef, code }),
      agreements.deleteMany({ clientRef, code }),
      grants.deleteMany({ code }),
      outbox.deleteMany({
        $or: [
          { "event.data.clientRef": clientRef },
          { "event.data.caseRef": clientRef },
          { "event.audit.details.clientRef": clientRef },
        ],
      }),
      versions.deleteMany({ "snapshot.clientRef": clientRef }),
    ]);

  beforeAll(async () => {
    client = await MongoClient.connect(env.MONGO_URI);
    const database = client.db();
    applications = database.collection("applications");
    agreements = database.collection("agreements__agreements");
    grants = database.collection("grants");
    outbox = database.collection("outbox");
    versions = database.collection("agreements__versions");
  });

  beforeEach(async () => {
    await clearScenarioData();
    await grants.insertOne(structuredClone(pmfGrantDefinition));
    await applications.insertOne(createApplication());
  });

  afterAll(async () => {
    await clearScenarioData();
    await client?.close();
  });

  it("creates the offer, stores it on the application and updates Caseworking", async () => {
    await sendMessage(env.GAS__SQS__UPDATE_STATUS_QUEUE_URL, {
      id: randomUUID(),
      traceparent: "pmf-create-agreement-trace",
      type: "fg.cw-backend.test.case.status.updated",
      source: "CW",
      data: {
        caseRef: clientRef,
        workflowCode: code,
        previousStatus: "PRE_AWARD:REVIEW_APPLICATION:IN_REVIEW",
        currentStatus: "PRE_AWARD:FINAL_REVIEW:APPLICATION_APPROVED",
      },
    });

    await expect(agreements).toHaveRecord({
      code,
      clientRef,
      state: "offered",
      version: 1,
    });
    const agreement = await agreements.findOne({ clientRef, code });

    await expect(versions).toHaveRecord({
      agreementNumber: agreement.agreementNumber,
      version: 1,
      "snapshot.state": "offered",
      "snapshot.supplementaryData.fundingCalculation.items.0.total": 32000,
    });
    await expect(applications).toHaveRecord({
      clientRef,
      code,
      currentStatus: "AGREEMENT_DRAFTED",
      [`agreements.${agreement.agreementNumber}.latestStatus`]: "OFFERED",
    });
    await expect(outbox).toHaveRecord({
      target: caseworkingUpdateTarget,
      "event.type": "cloud.defra.local.fg-gas-backend.case.update.status",
      "event.data.caseRef": clientRef,
      "event.data.workflowCode": code,
      "event.data.newStatus": "PRE_AWARD:REVIEW_OFFER:AGREEMENT_DRAFTED",
      "event.data.supplementaryData.targetNode": "agreements",
      "event.data.supplementaryData.data.agreementRef":
        agreement.agreementNumber,
    });
  });
});
