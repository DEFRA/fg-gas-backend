import { MongoClient } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { wreck } from "../helpers/wreck.js";

const agreementNumber = "PMF823153884";
const idempotencyKey = "9ea924aa-45e9-43a7-888e-c25054ea658c";
const createdAt = "2026-07-15T12:00:00.000Z";

const agreement = () => ({
  _id: agreementNumber,
  agreementNumber,
  version: 1,
  code: "pigs-might-fly",
  clientRef: "xnp-rr3-nfb",
  configVersion: "1.0.1",
  correlationId: "b5e8b244-6d60-42cd-8da6-3294c7439239",
  identifiers: { sbi: "300000070" },
  payload: { whitePigsCount: 5 },
  state: "offered",
  createdAt,
  updatedAt: createdAt,
  supplementaryData: {
    fundingCalculation: {
      items: [{ description: "Large White", total: 32000 }],
    },
  },
});

const requestAction = async ({
  values = { confirm: "confirmed" },
  ifMatch = `"${agreementNumber}:1"`,
  key = idempotencyKey,
} = {}) => {
  const response = await wreck.request(
    "POST",
    `/agreements/${agreementNumber}/actions/accept`,
    {
      headers: { "if-match": ifMatch, "idempotency-key": key },
      payload: { values },
    },
  );
  const payload = await wreck.read(response, { json: true });
  return { response, payload };
};

describe("single Agreement actions", () => {
  let client;
  let agreements;
  let versions;
  let outbox;

  beforeAll(async () => {
    client = await MongoClient.connect(env.MONGO_URI);
    const database = client.db();
    agreements = database.collection("agreements__agreements");
    versions = database.collection("agreements__versions");
    outbox = database.collection("outbox");
  });

  beforeEach(async () => {
    await Promise.all([
      agreements.deleteMany({ agreementNumber }),
      versions.deleteMany({ agreementNumber }),
      outbox.deleteMany({ "event.data.agreementNumber": agreementNumber }),
    ]);
    const current = agreement();
    await agreements.insertOne(current);
    await versions.insertOne({
      agreementNumber,
      version: 1,
      snapshot: { ...current, _id: undefined },
      versionedAt: createdAt,
    });
  });

  afterAll(async () => {
    await Promise.all([
      agreements.deleteMany({ agreementNumber }),
      versions.deleteMany({ agreementNumber }),
      outbox.deleteMany({ "event.data.agreementNumber": agreementNumber }),
    ]);
    await client.close();
  });

  it("prepares the action without Agreement Item identity", async () => {
    const response = await wreck.request(
      "GET",
      `/agreements/${agreementNumber}/actions/accept`,
    );
    const payload = await wreck.read(response, { json: true });

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe(`"${agreementNumber}:1"`);
    expect(payload.agreement.agreementNumber).toBe(agreementNumber);
    expect(JSON.stringify(payload)).not.toContain("agreementItem");
  });

  it("accepts and atomically records current Agreement, Version and event", async () => {
    const { response } = await requestAction();

    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe(`/agreements/${agreementNumber}`);
    await expect(agreements).toHaveRecord({
      agreementNumber,
      version: 2,
      state: "accepted",
    });
    const accepted = await agreements.findOne({ agreementNumber });
    expect(accepted.acceptedAt).toEqual(expect.any(String));
    await expect(versions).toHaveRecord({
      agreementNumber,
      version: 2,
      "snapshot.state": "accepted",
      "actionExecution.name": "accept",
      "actionExecution.idempotencyKey": idempotencyKey,
    });
  });

  it("returns configured validation without changing the Agreement", async () => {
    const { response, payload } = await requestAction({ values: {} });

    expect(response.statusCode).toBe(422);
    expect(payload.errors[0].name).toBe("confirm");
    await expect(agreements).toHaveRecord({ agreementNumber, version: 1 });
  });

  it("rejects a stale expected version", async () => {
    const { response } = await requestAction({ ifMatch: '"PMF823153884:0"' });

    expect(response.statusCode).toBe(412);
    expect(response.headers.etag).toBe(`"${agreementNumber}:1"`);
  });

  it("replays a successful idempotency key without another Version", async () => {
    const first = await requestAction();
    const replay = await requestAction();

    expect(first.response.statusCode).toBe(303);
    expect(replay.response.statusCode).toBe(303);
    expect(await versions.countDocuments({ agreementNumber })).toBe(2);
  });
});
