import { MongoClient } from "mongodb";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { env } from "node:process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { wreck } from "../helpers/wreck.js";

const code = "pigs-might-fly";
const sbi = "300000071";
const configVersion = "1.0.1";
const pmfGrantDefinition = JSON.parse(
  readFileSync(
    new URL("../fixtures/pmf-grant-definition.json", import.meta.url),
    "utf8",
  ),
);

const answers = {
  whitePigsCount: 5,
  britishLandracePigsCount: 0,
  berkshirePigsCount: 0,
  otherPigsCount: 0,
};

const createPayload = (clientRef) => ({
  code,
  clientRef,
  currentConfigVersion: configVersion,
  identifiers: { sbi, frn: "1101234567" },
  answers,
});

const post = (path, payload) =>
  wreck.request("POST", path, { payload, json: true });

const postJson = async (path, payload) => {
  const response = await post(path, payload);
  return {
    statusCode: response.statusCode,
    body: await wreck.read(response, { json: true }),
  };
};

// wreck resolves with the response for any status code, so the status code of
// an error response is read directly from that response.
const postExpectingError = async (path, payload) => {
  const response = await post(path, payload);
  return response.statusCode;
};

describe("Agreement test endpoints", () => {
  let client;
  let agreements;
  let grants;
  let outbox;
  let versions;
  let payments;
  let clientRef;

  const clearScenarioData = () =>
    Promise.all([
      agreements.deleteMany({ code }),
      grants.deleteMany({ code }),
      outbox.deleteMany({ "event.data.code": code }),
      versions.deleteMany({ "snapshot.code": code }),
      payments.deleteMany({ "source.code": code }),
    ]);

  beforeAll(async () => {
    client = await MongoClient.connect(env.MONGO_URI);
    const database = client.db();
    agreements = database.collection("agreements__agreements");
    grants = database.collection("grants");
    outbox = database.collection("outbox");
    versions = database.collection("agreements__versions");
    payments = database.collection("payments__payments");
  });

  beforeEach(async () => {
    await clearScenarioData();
    await grants.insertOne({
      ...structuredClone(pmfGrantDefinition),
      version: configVersion,
    });
    // Creation is idempotent on (code, clientRef), so each scenario needs its
    // own clientRef to actually create a new Agreement.
    clientRef = `pmf-test-endpoint-${randomUUID()}`;
  });

  afterAll(async () => {
    await clearScenarioData();
    await client?.close();
  });

  const createAgreement = async () => {
    const { body } = await postJson(
      "/api/test/agreements",
      createPayload(clientRef),
    );
    return body.agreementData.agreementNumber;
  };

  describe("POST /api/test/agreements", () => {
    it("creates a GAS-managed Agreement and returns its agreement number", async () => {
      const { statusCode, body } = await postJson(
        "/api/test/agreements",
        createPayload(clientRef),
      );

      expect(statusCode).toBe(201);
      expect(body.agreementData.agreementNumber).toEqual(expect.any(String));
      expect(body.agreementData).toMatchObject({
        code,
        clientRef,
        state: "offered",
        version: 1,
      });

      await expect(agreements).toHaveRecord({
        agreementNumber: body.agreementData.agreementNumber,
        state: "offered",
        version: 1,
      });
      await expect(versions).toHaveRecord({
        agreementNumber: body.agreementData.agreementNumber,
        version: 1,
        "snapshot.state": "offered",
        "snapshot.application.whitePigsCount": 5,
      });
    });

    it("rejects missing agreement data without creating an Agreement", async () => {
      const { code: _omitted, ...withoutCode } = createPayload(clientRef);

      const statusCode = await postExpectingError(
        "/api/test/agreements",
        withoutCode,
      );

      expect(statusCode).toBe(400);
      expect(await agreements.countDocuments({ clientRef })).toBe(0);
    });

    it("rejects a grant code that GAS does not manage", async () => {
      const statusCode = await postExpectingError("/api/test/agreements", {
        ...createPayload(clientRef),
        code: "not-a-gas-managed-grant",
      });

      expect(statusCode).toBe(400);
    });
  });

  describe("POST /api/test/agreements/{agreementNumber}/status", () => {
    it.each(["withdrawn", "cancelled"])(
      "applies the %s transition and returns the updated state",
      async (status) => {
        const agreementNumber = await createAgreement();

        const { statusCode, body } = await postJson(
          `/api/test/agreements/${agreementNumber}/status`,
          { status },
        );

        expect(statusCode).toBe(200);
        expect(body.agreementData).toMatchObject({
          agreementNumber,
          state: status,
          version: 2,
        });
        await expect(agreements).toHaveRecord({
          agreementNumber,
          state: status,
          version: 2,
        });
      },
    );

    it("rejects a transition that is invalid from the current state and leaves the Agreement unchanged", async () => {
      const agreementNumber = await createAgreement();

      // terminate is reachable only from accepted, and creation lands in offered.
      const statusCode = await postExpectingError(
        `/api/test/agreements/${agreementNumber}/status`,
        { status: "terminated" },
      );

      expect(statusCode).toBe(409);
      await expect(agreements).toHaveRecord({
        agreementNumber,
        state: "offered",
        version: 1,
      });
      expect(await versions.countDocuments({ agreementNumber })).toBe(1);
    });

    it("rejects an unsupported status without changing the Agreement", async () => {
      const agreementNumber = await createAgreement();

      const statusCode = await postExpectingError(
        `/api/test/agreements/${agreementNumber}/status`,
        { status: "accepted" },
      );

      expect(statusCode).toBe(400);
      await expect(agreements).toHaveRecord({
        agreementNumber,
        state: "offered",
        version: 1,
      });
    });

    it("returns 404 for an Agreement number that does not exist", async () => {
      const statusCode = await postExpectingError(
        "/api/test/agreements/PMF000000000/status",
        { status: "withdrawn" },
      );

      expect(statusCode).toBe(404);
    });
  });
});
