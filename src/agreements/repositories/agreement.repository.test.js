import { describe, expect, it, vi } from "vitest";
import { db } from "../../common/mongo-client.js";
import { AgreementVersion } from "../models/agreement-version.js";
import { Agreement } from "../models/agreement.js";
import {
  agreementsCollection,
  findAgreementByNumber,
  findAgreementBySourceIdentity,
  findVersionByIdempotencyKey,
  insertAgreementVersion,
  insertCurrentAgreement,
  replaceCurrentAgreement,
  versionsCollection,
} from "./agreement.repository.js";

vi.mock("../../common/mongo-client.js");

const agreement = new Agreement({
  agreementNumber: "PMF823153883",
  version: 1,
  code: "pigs-might-fly",
  clientRef: "xnp-rr3-nfa",
  configVersion: "1.0.1",
  correlationId: "b5e8b244-6d60-42cd-8da6-3294c7439239",
  identifiers: { sbi: "300000069" },
  payload: { whitePigsCount: 5 },
  state: "offered",
  createdAt: "2026-07-17T11:29:00.000Z",
  updatedAt: "2026-07-17T11:29:00.000Z",
});

describe("single Agreement repository", () => {
  it("reads the current Agreement by number from the primary", async () => {
    const findOne = vi.fn().mockResolvedValue({
      _id: agreement.agreementNumber,
      ...structuredClone(agreement),
    });
    db.collection.mockReturnValue({ findOne });
    const session = {};

    const result = await findAgreementByNumber(
      agreement.agreementNumber,
      session,
    );

    expect(db.collection).toHaveBeenCalledWith(agreementsCollection);
    expect(findOne).toHaveBeenCalledWith(
      { _id: agreement.agreementNumber },
      { session, readPreference: "primary" },
    );
    expect(result).toEqual(agreement);
  });

  it("reads an idempotent action result from the primary", async () => {
    const idempotencyKey = "9ea924aa-45e9-43a7-888e-c25054ea658c";
    const version = new AgreementVersion({
      agreementNumber: agreement.agreementNumber,
      version: 2,
      snapshot: new Agreement({ ...agreement, version: 2 }),
      versionedAt: "2026-07-18T09:15:00.000Z",
      actionExecution: { name: "accept", idempotencyKey },
    });
    const findOne = vi.fn().mockResolvedValue(structuredClone(version));
    db.collection.mockReturnValue({ findOne });
    const session = {};

    const result = await findVersionByIdempotencyKey(
      agreement.agreementNumber,
      idempotencyKey,
      session,
    );

    expect(db.collection).toHaveBeenCalledWith(versionsCollection);
    expect(findOne).toHaveBeenCalledWith(
      {
        agreementNumber: agreement.agreementNumber,
        "actionExecution.idempotencyKey": idempotencyKey,
      },
      { session, readPreference: "primary" },
    );
    expect(result).toEqual(version);
  });

  it("finds the current Agreement by code and client reference", async () => {
    const findOne = vi.fn().mockResolvedValue({
      _id: agreement.agreementNumber,
      ...structuredClone(agreement),
    });
    db.collection.mockReturnValue({ findOne });

    const result = await findAgreementBySourceIdentity({
      code: agreement.code,
      clientRef: agreement.clientRef,
    });

    expect(db.collection).toHaveBeenCalledWith(agreementsCollection);
    expect(findOne).toHaveBeenCalledWith(
      { code: agreement.code, clientRef: agreement.clientRef },
      { session: undefined },
    );
    expect(result).toEqual(agreement);
  });

  it("stores Agreement Number as the current document id", async () => {
    const insertOne = vi.fn();
    db.collection.mockReturnValue({ insertOne });
    const session = {};

    await insertCurrentAgreement(agreement, session);

    const [document] = insertOne.mock.calls[0];
    expect(insertOne).toHaveBeenCalledWith(
      { _id: agreement.agreementNumber, ...structuredClone(agreement) },
      { session },
    );
    expect(document).not.toHaveProperty("acceptedAt");
    expect(document).not.toHaveProperty("paymentCalculation");
    expect(document).not.toHaveProperty("supplementaryData");
  });

  it("replaces the current Agreement only at the expected version", async () => {
    const replaceOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    db.collection.mockReturnValue({ replaceOne });
    const nextAgreement = new Agreement({
      ...agreement,
      version: 2,
      state: "accepted",
      updatedAt: "2026-07-18T09:15:00.000Z",
    });
    const session = {};

    await replaceCurrentAgreement(nextAgreement, 1, session);

    expect(db.collection).toHaveBeenCalledWith(agreementsCollection);
    expect(replaceOne).toHaveBeenCalledWith(
      { _id: agreement.agreementNumber, version: 1 },
      { _id: agreement.agreementNumber, ...structuredClone(nextAgreement) },
      { session },
    );
  });

  it("stores the complete immutable Version snapshot without a domain id", async () => {
    const insertOne = vi.fn();
    db.collection.mockReturnValue({ insertOne });
    const version = AgreementVersion.create({
      agreement,
      versionedAt: agreement.createdAt,
    });

    await insertAgreementVersion(version);

    const [document] = insertOne.mock.calls[0];
    expect(db.collection).toHaveBeenCalledWith(versionsCollection);
    expect(insertOne).toHaveBeenCalledWith(
      {
        agreementNumber: agreement.agreementNumber,
        version: 1,
        snapshot: structuredClone(agreement),
        versionedAt: agreement.createdAt,
      },
      { session: undefined },
    );
    expect(document.snapshot).not.toHaveProperty("acceptedAt");
    expect(document.snapshot).not.toHaveProperty("paymentCalculation");
    expect(document.snapshot).not.toHaveProperty("supplementaryData");
  });
});
