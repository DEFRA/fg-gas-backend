import Boom from "@hapi/boom";
import { MongoServerError } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { db } from "../../common/mongo-client.js";
import { AgreementItem } from "../models/agreement-item.js";
import { AgreementVersion } from "../models/agreement-version.js";
import { Agreement } from "../models/agreement.js";
import {
  agreementsCollection,
  findByAgreementNumber,
  saveAgreement,
  saveVersion,
  versionsCollection,
} from "./agreement.repository.js";
import { AgreementDocument } from "./agreement/agreement-document.js";
import { AgreementVersionDocument } from "./agreement/agreement-version-document.js";

vi.mock("../../common/mongo-client.js");

const testAgreement = new Agreement({
  id: "a889f23f-8256-4150-b82d-ee0e33a345f5",
  agreementNumber: "PMF823153883",
  code: "pigs-might-fly",
  identifiers: { sbi: "300000069", frn: "frn", crn: "1300000069" },
  items: [
    new AgreementItem({
      agreementItemId: "29b829c4-4e38-405c-9f00-427ee94120a5",
      agreementCode: "pigs-might-fly",
      clientRef: "xnp-rr3-nfa",
      sourceSystem: "GAS",
      configVersion: "0.0.1",
      identifiers: { sbi: "300000069" },
      payload: null,
      createdAt: "2026-06-17T09:09:32.395Z",
    }),
  ],
  createdAt: "2026-06-17T09:09:32.395Z",
  updatedAt: "2026-06-17T09:09:32.395Z",
});

const testVersion = new AgreementVersion({
  id: "f8d555b6-57c2-4c33-9548-42b42387c427",
  agreementId: "a889f23f-8256-4150-b82d-ee0e33a345f5",
  agreementNumber: "PMF823153883",
  version: 1,
  snapshot: testAgreement,
  createdAt: "2026-06-17T09:09:32.395Z",
});

describe("saveAgreement", () => {
  it("inserts the agreement document into the agreements collection", async () => {
    const insertOne = vi
      .fn()
      .mockResolvedValue({ insertedId: testAgreement.id });
    db.collection.mockReturnValue({ insertOne });

    const session = {};
    await saveAgreement(testAgreement, session);

    expect(db.collection).toHaveBeenCalledWith(agreementsCollection);
    expect(insertOne).toHaveBeenCalledWith(
      new AgreementDocument(testAgreement),
      { session },
    );
  });

  it("throws Boom.conflict with agreement number message when agreementNumber index fires", async () => {
    const error = new MongoServerError("E11000 duplicate key error collection");
    error.code = 11000;
    error.keyPattern = { agreementNumber: 1 };

    db.collection.mockReturnValue({
      insertOne: vi.fn().mockRejectedValueOnce(error),
    });

    await expect(saveAgreement(testAgreement)).rejects.toThrow(
      Boom.conflict(
        `Agreement with number "${testAgreement.agreementNumber}" already exists`,
      ),
    );
  });

  it("throws Boom.conflict with source identity message when items index fires", async () => {
    const error = new MongoServerError("E11000 duplicate key error collection");
    error.code = 11000;
    error.keyPattern = { "items.agreementCode": 1, "items.clientRef": 1 };

    db.collection.mockReturnValue({
      insertOne: vi.fn().mockRejectedValueOnce(error),
    });

    await expect(saveAgreement(testAgreement)).rejects.toThrow(
      Boom.conflict(
        "Agreement item with the same source identity already exists",
      ),
    );
  });

  it("rethrows unexpected errors", async () => {
    const error = new Error("connection failed");

    db.collection.mockReturnValue({
      insertOne: vi.fn().mockRejectedValueOnce(error),
    });

    await expect(saveAgreement(testAgreement)).rejects.toThrow(error);
  });
});

describe("saveVersion", () => {
  it("inserts the version document with snapshot stored using _id instead of id", async () => {
    const insertOne = vi.fn().mockResolvedValue({ insertedId: testVersion.id });
    db.collection.mockReturnValue({ insertOne });

    const session = {};
    await saveVersion(testVersion, session);

    expect(db.collection).toHaveBeenCalledWith(versionsCollection);

    expect(insertOne).toHaveBeenCalledWith(
      new AgreementVersionDocument(testVersion),
      { session },
    );
  });
});

describe("findByAgreementNumber", () => {
  it("finds an agreement and maps it to the domain model", async () => {
    const doc = {
      _id: "a889f23f-8256-4150-b82d-ee0e33a345f5",
      agreementNumber: "PMF823153883",
      code: "pigs-might-fly",
      identifiers: { sbi: "300000069", frn: "frn", crn: "1300000069" },
      items: [
        {
          agreementItemId: "29b829c4-4e38-405c-9f00-427ee94120a5",
          agreementCode: "pigs-might-fly",
          clientRef: "xnp-rr3-nfa",
          sourceSystem: "GAS",
          configVersion: "0.0.1",
          identifiers: { sbi: "300000069" },
          payload: null,
          createdAt: "2026-06-17T09:09:32.395Z",
        },
      ],
      createdAt: "2026-06-17T09:09:32.395Z",
      updatedAt: "2026-06-17T09:09:32.395Z",
    };

    const findOne = vi.fn().mockResolvedValueOnce(doc);
    db.collection.mockReturnValue({ findOne });

    const result = await findByAgreementNumber("PMF823153883");

    expect(db.collection).toHaveBeenCalledWith(agreementsCollection);
    expect(findOne).toHaveBeenCalledWith({ agreementNumber: "PMF823153883" });
    expect(result).toStrictEqual(testAgreement);
  });

  it("returns null when no agreement is found", async () => {
    db.collection.mockReturnValue({
      findOne: vi.fn().mockResolvedValueOnce(null),
    });

    const result = await findByAgreementNumber("PMF000000000");

    expect(result).toBeNull();
  });

  it("returns an agreement with an empty items array when items is missing from the document", async () => {
    const doc = {
      _id: "a889f23f-8256-4150-b82d-ee0e33a345f5",
      agreementNumber: "PMF823153883",
      code: "pigs-might-fly",
      identifiers: { sbi: "300000069" },
      createdAt: "2026-06-17T09:09:32.395Z",
      updatedAt: "2026-06-17T09:09:32.395Z",
    };

    db.collection.mockReturnValue({
      findOne: vi.fn().mockResolvedValueOnce(doc),
    });

    const result = await findByAgreementNumber("PMF823153883");

    expect(result.items).toEqual([]);
  });
});
