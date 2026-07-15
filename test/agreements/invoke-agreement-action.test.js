import { MongoClient } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { wreck } from "../helpers/wreck.js";

const agreementNumber = "PMF823153884";
const code = "pigs-might-fly";
const clientRef = "xnp-rr3-nfb";
const sbi = "300000070";
const agreementId = "invoke-agreement-action-id";

const toItem = (status) => ({
  agreementItemId: "invoke-agreement-action-item-id",
  agreementCode: code,
  clientRef,
  sourceSystem: "GAS",
  configVersion: "0.0.1",
  identifiers: { sbi },
  payload: {},
  createdAt: "2026-07-15T12:00:00.000Z",
  status,
});

const toAgreement = () => ({
  _id: agreementId,
  agreementNumber,
  code,
  identifiers: { sbi },
  items: [toItem("offered")],
  createdAt: "2026-07-15T12:00:00.000Z",
  updatedAt: "2026-07-15T12:00:00.000Z",
});

const toVersion = (status) => ({
  _id: `invoke-agreement-action-version-${status}`,
  agreementId,
  agreementNumber,
  version: 1,
  snapshot: {
    ...toAgreement(),
    items: [toItem(status)],
  },
  createdAt: "2026-07-15T12:01:00.000Z",
});

const requestAction = async (actionName, answers = {}) => {
  const res = await wreck.request(
    "POST",
    `/agreements/${agreementNumber}/actions/${actionName}`,
    {
      payload: { code, clientRef, sbi, ...answers },
    },
  );
  const payload = await wreck.read(res, { json: true });

  return { res, payload };
};
describe("POST /agreements/{agreementNumber}/actions/{actionName}", () => {
  let client;
  let agreements;
  let versions;

  beforeAll(async () => {
    client = await MongoClient.connect(env.MONGO_URI);
    const database = client.db();
    agreements = database.collection("agreements__agreements");
    versions = database.collection("agreements__versions");
  });

  beforeEach(async () => {
    await Promise.all([
      agreements.deleteMany({ agreementNumber }),
      versions.deleteMany({ agreementNumber }),
    ]);
  });

  afterAll(async () => {
    await Promise.all([
      agreements?.deleteMany({ agreementNumber }),
      versions?.deleteMany({ agreementNumber }),
    ]);
    await client?.close();
  });

  const seedAgreement = async (status = "offered") => {
    await agreements.insertOne(toAgreement());
    await versions.insertOne(toVersion(status));
  };

  it("returns the configured transition for valid confirmation without persisting it", async () => {
    await seedAgreement();

    const { res, payload } = await requestAction("accept", {
      confirm: "confirmed",
    });

    expect(res.statusCode).toBe(200);
    expect(payload).toEqual({
      valid: true,
      transition: {
        from: "offered",
        action: "accept",
        target: "accepted",
      },
    });
    expect(await versions.countDocuments({ agreementNumber })).toBe(1);
  });

  it("renders the configured page and error when confirmation is missing", async () => {
    await seedAgreement();

    const { res, payload } = await requestAction("accept");

    expect(res.statusCode).toBe(200);
    expect(payload).toMatchObject({
      agreementNumber,
      code,
      clientRef,
      sbi,
      status: "offered",
      page: {
        name: "accept",
        title: "Accept your agreement offer",
        mode: "view",
      },
      errors: [
        {
          name: "confirm",
          href: "#confirm",
          message: "Confirm this agreement offer before accepting it",
        },
      ],
    });
    expect(await versions.countDocuments({ agreementNumber })).toBe(1);
    expect(
      await versions.findOne(
        { agreementNumber },
        { projection: { snapshot: 1 } },
      ),
    ).toMatchObject({ snapshot: { items: [{ status: "offered" }] } });
  });

  it("rejects an action not configured for the current state", async () => {
    await seedAgreement();

    const { res, payload } = await requestAction("decline");

    expect(res.statusCode).toBe(409);
    expect(payload).toMatchObject({
      statusCode: 409,
      error: "Conflict",
      message:
        'Unknown action "decline" for state "offered" on agreement code "pigs-might-fly"',
    });
    expect(await versions.countDocuments({ agreementNumber })).toBe(1);
  });

  it("rejects duplicate accept from the latest accepted snapshot", async () => {
    await seedAgreement("accepted");

    const { res } = await requestAction("accept", { confirm: "confirmed" });

    expect(res.statusCode).toBe(409);
    expect(await versions.countDocuments({ agreementNumber })).toBe(1);
  });
});
