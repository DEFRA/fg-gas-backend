import { MongoClient } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  Application,
  ApplicationPhase,
  ApplicationStage,
  ApplicationStatus,
} from "../../src/grants/models/application.js";
import { GrantDocument } from "../../src/grants/models/grant-document.js";
import { createTestGrant } from "../helpers/grants.js";
import { wreck } from "../helpers/wreck.js";

let applications;
let grants;
let client;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  applications = client.db().collection("applications");
  grants = client.db().collection("grants");
});

afterAll(async () => {
  await client?.close();
});

describe("GET /grants/{code}/applications/{clientRef}/status", () => {
  const clientRef = "client-ref-1";
  const code = "grant-1";

  it("should get application status", async () => {
    // The status endpoint resolves the grant definition for the application,
    // so a legacy (unversioned) grant document must exist for the code.
    await grants.insertOne(new GrantDocument(createTestGrant({ code })));

    await applications.insertOne(
      Application.new({
        clientRef,
        code,
        currentPhase: ApplicationPhase.PreAward,
        currentStage: ApplicationStage.Assessment,
        currentStatus: ApplicationStage.Assessment,
        phases: [
          {
            code: ApplicationPhase.PreAward,
            questions: {},
            stages: [
              {
                code: ApplicationStage.Assessment,
                statuses: [{ code: ApplicationStatus.Received }],
              },
            ],
          },
        ],
        identifiers: {
          sbi: "123",
          frn: "456",
          crn: "789",
          defraId: "abc",
        },
      }),
    );

    const response = await wreck.get(
      "/grants/grant-1/applications/client-ref-1/status",
      {
        json: true,
      },
    );

    expect(response.res.statusCode).toBe(200);
    expect(response.payload).toEqual({
      phase: ApplicationPhase.PreAward,
      stage: ApplicationStage.Assessment,
      status: ApplicationStage.Assessment,
      grantCode: code,
      clientRef,
      originalConfigVersion: null,
      currentConfigVersion: null,
    });
  });
});
