import { randomUUID } from "node:crypto";
import {
  Application,
  ApplicationPhase,
  ApplicationStage,
  ApplicationStatus,
} from "../../src/grants/models/application.js";
import {
  ConfigVersion,
  FetchStatus,
} from "../../src/grants/models/config-version.js";
import { wreck } from "./wreck.js";

export const createTestApplication = (overrides = {}) => {
  return Application.new({
    currentPhase: ApplicationPhase.PreAward,
    currentStage: ApplicationStage.Assessment,
    currentStatus: ApplicationStatus.Received,
    clientRef: "application-1",
    code: "grant-1",
    submittedAt: "2021-01-01T00:00:00.000Z",
    identifiers: {
      sbi: "sbi-1",
      frn: "frn-1",
      crn: "crn-1",
    },
    metadata: {
      defraId: "defraId-1",
    },
    phases: [
      {
        code: "PRE_AWARD",
        answers: {
          answer1: "test",
        },
      },
    ],
    ...overrides,
  });
};

export const seedConfigVersion = async (db, code, version = "1.0.0") => {
  const cv = ConfigVersion.new({
    grantCode: code,
    version,
    status: "active",
    s3Key: `${code}/${version}/grant-definition.json`,
    s3Bucket: "config-broker-local",
  });
  const doc = cv.toDocument();
  doc.fetchStatus = FetchStatus.Fetched;
  doc.fetchedAt = new Date().toISOString();
  await db
    .collection("config_versions")
    .updateOne({ grantCode: code, version }, { $set: doc }, { upsert: true });
};

export const submitApplication = async (db) => {
  const clientRef = `cr-12345-${randomUUID()}`;
  const code = "test-code-1";

  await seedConfigVersion(db, code);

  await wreck.post(`/grants/${code}/applications`, {
    headers: {
      "x-cdp-request-id": "xxxx-xxxx-xxxx-xxxx",
    },
    payload: {
      configVersion: "1.0.0",
      metadata: {
        clientRef,
        submittedAt: new Date().toISOString(),
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

  return { clientRef, code };
};
