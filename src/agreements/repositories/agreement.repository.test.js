import { describe, expect, it, vi } from "vitest";
import { db } from "../../common/mongo-client.js";
import { AgreementVersion } from "../models/agreement-version.js";
import { Agreement } from "../models/agreement.js";
import {
  agreementsCollection,
  findAgreementBySourceIdentity,
  insertAgreementVersion,
  insertCurrentAgreement,
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

    expect(insertOne).toHaveBeenCalledWith(
      { _id: agreement.agreementNumber, ...structuredClone(agreement) },
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
  });
});
