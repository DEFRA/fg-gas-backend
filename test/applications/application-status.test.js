import { MongoClient } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Application } from "../../src/grants/models/application";
import { wreck } from "../helpers/wreck.js";

let applications;
let client;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  applications = client.db().collection("applications");
});

afterAll(async () => {
  await client?.close();
});

describe("GET /grants/{code}/applications/{clientRef}/status", () => {
  const clientRef = "client-ref-1";
  const code = "grant-1";

  it("should get application status", async () => {
    await applications.insertOne(
      Application.new({
        clientRef,
        code,
        phases: [
          {
            code: "PHASE_1",
            questions: {},
            stages: [{ code: "STAGE_1", statuses: [{ code: "NEW" }] }],
          },
        ],
        identifiers: [],
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
      phase: "PRE_AWARD",
      stage: "ASSESSMENT",
      status: "RECEIVED",
      grantCode: code,
      clientRef,
    });
  });
});
