import { MongoClient } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { wreck } from "../helpers/wreck.js";

const agreementNumber = "PMF823153886";
const code = "pigs-might-fly";
const clientRef = "document-view-client";
const sbi = "300000072";
const createdAt = "2026-07-15T12:00:00.000Z";

const agreement = {
  _id: agreementNumber,
  agreementNumber,
  version: 1,
  code,
  clientRef,
  configVersion: "1.0.1",
  correlationId: "7e8c624d-6cf3-4ac5-bb84-a6f6701a6b7d",
  identifiers: { sbi },
  payload: { businessName: "Gotham City Pigs" },
  state: "offered",
  createdAt,
  updatedAt: createdAt,
  supplementaryData: {
    fundingCalculation: {
      items: [{ description: "Large White Pig", total: 10000 }],
    },
  },
};

describe("read-only Agreement document", () => {
  let agreements;
  let client;

  beforeAll(async () => {
    client = await MongoClient.connect(env.MONGO_URI);
    agreements = client.db().collection("agreements__agreements");
  });

  beforeEach(async () => {
    await agreements.deleteMany({ agreementNumber });
    await agreements.insertOne(structuredClone(agreement));
  });

  afterAll(async () => {
    await agreements.deleteMany({ agreementNumber });
    await client.close();
  });

  it("returns the configured document without applicant actions", async () => {
    const response = await wreck.request(
      "GET",
      `/agreements/${agreementNumber}/document?code=${code}&clientRef=${clientRef}&sbi=${sbi}`,
    );
    const payload = await wreck.read(response, { json: true });

    expect(response.statusCode).toBe(200);
    expect(payload).toMatchObject({
      agreement: { agreementNumber, code, clientRef, identifiers: { sbi } },
      page: {
        name: "document",
        title: "Pigs Might Fly agreement document",
        layout: "document",
      },
      actions: [],
    });
  });

  it("does not disclose a document when its case reference does not match", async () => {
    const response = await wreck.request(
      "GET",
      `/agreements/${agreementNumber}/document?code=${code}&clientRef=another-case&sbi=${sbi}`,
    );

    expect(response.statusCode).toBe(404);
  });

  it("keeps the applicant current Agreement interactive", async () => {
    const response = await wreck.request(
      "GET",
      `/agreements/current?code=${code}&clientRef=${clientRef}&sbi=${sbi}`,
    );
    const payload = await wreck.read(response, { json: true });

    expect(response.statusCode).toBe(200);
    expect(payload).toMatchObject({
      page: { name: "offered", title: "Review your agreement offer" },
      actions: [{ name: "accept", text: "Continue", method: "GET" }],
    });
  });
});
