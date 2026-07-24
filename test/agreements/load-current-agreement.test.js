import { MongoClient } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  loadCurrentAgreement,
  loadCurrentAgreementByNumber,
} from "../../src/agreements/use-cases/load-current-agreement.js";

const agreementNumber = "PMF823153885";
const code = "pigs-might-fly";
const clientRef = "load-current-client";
const sbi = "300000071";
const current = {
  _id: agreementNumber,
  agreementNumber,
  version: 2,
  code,
  clientRef,
  configVersion: "1.0.1",
  correlationId: "b5e8b244-6d60-42cd-8da6-3294c7439239",
  identifiers: { sbi },
  payload: {},
  state: "accepted",
  createdAt: "2026-07-15T12:00:00.000Z",
  updatedAt: "2026-07-16T12:00:00.000Z",
};

describe("load one current Agreement", () => {
  let client;
  let agreements;

  beforeAll(async () => {
    client = await MongoClient.connect(env.MONGO_URI);
    agreements = client.db().collection("agreements__agreements");
  });

  beforeEach(async () => {
    await agreements.deleteMany({ agreementNumber });
    await agreements.insertOne(structuredClone(current));
  });

  afterAll(async () => {
    await agreements.deleteMany({ agreementNumber });
    await client.close();
  });

  it("loads direct current state by source identity and SBI scope", async () => {
    const result = await loadCurrentAgreement({ code, clientRef, sbi });

    expect(result).toMatchObject({
      agreementNumber,
      version: 2,
      state: "accepted",
    });
    expect(result).not.toHaveProperty("items");
  });

  it("loads canonical current state by Agreement Number", async () => {
    await expect(
      loadCurrentAgreementByNumber({ agreementNumber }),
    ).resolves.toMatchObject({ agreementNumber, version: 2 });
  });

  it("does not disclose an Agreement outside the SBI account", async () => {
    await expect(
      loadCurrentAgreement({ code, clientRef, sbi: "999999999" }),
    ).rejects.toMatchObject({ output: { statusCode: 404 } });
  });

  it("returns not found for an unknown Agreement Number", async () => {
    await expect(
      loadCurrentAgreementByNumber({ agreementNumber: "PMF000000000" }),
    ).rejects.toMatchObject({ output: { statusCode: 404 } });
  });
});
