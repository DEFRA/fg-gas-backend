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
  findByClientRefAndCode,
  findByClientRefCodeAndSbi,
  findLatestVersionByAgreementNumber,
  findVersionByActionIdempotencyKey,
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

  it("persists the action execution that produced the version", async () => {
    const insertOne = vi.fn().mockResolvedValue({ insertedId: testVersion.id });
    db.collection.mockReturnValue({ insertOne });
    const actionExecution = {
      name: "accept",
      agreementItemId: testAgreement.items[0].agreementItemId,
      idempotencyKey: "9ea924aa-45e9-43a7-888e-c25054ea658c",
    };
    const version = new AgreementVersion({
      ...testVersion,
      actionExecution,
    });

    await saveVersion(version);

    expect(insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ actionExecution }),
      { session: undefined },
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

    const session = { fake: "session" };
    const result = await findByAgreementNumber("PMF823153883", session);

    expect(db.collection).toHaveBeenCalledWith(agreementsCollection);
    expect(findOne).toHaveBeenCalledWith(
      { agreementNumber: "PMF823153883" },
      { session },
    );
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

describe("findVersionByActionIdempotencyKey", () => {
  it("finds the version produced by an idempotent action execution", async () => {
    const actionExecution = {
      name: "accept",
      agreementItemId: testAgreement.items[0].agreementItemId,
      idempotencyKey: "9ea924aa-45e9-43a7-888e-c25054ea658c",
    };
    const doc = {
      _id: testVersion.id,
      agreementId: testVersion.agreementId,
      agreementNumber: testVersion.agreementNumber,
      version: testVersion.version,
      snapshot: new AgreementDocument(testAgreement),
      createdAt: testVersion.createdAt,
      actionExecution,
    };
    const findOne = vi.fn().mockResolvedValue(doc);
    db.collection.mockReturnValue({ findOne });
    const session = { fake: "session" };

    const result = await findVersionByActionIdempotencyKey(
      testVersion.agreementNumber,
      actionExecution.agreementItemId,
      actionExecution.idempotencyKey,
      session,
    );

    expect(findOne).toHaveBeenCalledWith(
      {
        agreementNumber: testVersion.agreementNumber,
        "actionExecution.agreementItemId": actionExecution.agreementItemId,
        "actionExecution.idempotencyKey": actionExecution.idempotencyKey,
      },
      { session },
    );
    expect(result.actionExecution).toEqual(actionExecution);
  });
});

describe("findLatestVersionByAgreementNumber", () => {
  it("finds the highest-versioned snapshot and maps it to the domain model", async () => {
    const doc = {
      _id: testVersion.id,
      agreementId: testVersion.agreementId,
      agreementNumber: testVersion.agreementNumber,
      version: testVersion.version,
      snapshot: new AgreementDocument(testAgreement),
      createdAt: testVersion.createdAt,
    };

    const findOne = vi.fn().mockResolvedValueOnce(doc);
    db.collection.mockReturnValue({ findOne });

    const session = { fake: "session" };
    const result = await findLatestVersionByAgreementNumber(
      "PMF823153883",
      session,
    );

    expect(db.collection).toHaveBeenCalledWith(versionsCollection);
    expect(findOne).toHaveBeenCalledWith(
      { agreementNumber: "PMF823153883" },
      { session, sort: { version: -1 } },
    );
    expect(result).toStrictEqual(testVersion);
  });

  it("returns null when no version is found", async () => {
    db.collection.mockReturnValue({
      findOne: vi.fn().mockResolvedValueOnce(null),
    });

    const result = await findLatestVersionByAgreementNumber("PMF000000000");

    expect(result).toBeNull();
  });
});

describe("findByClientRefAndCode", () => {
  it("finds an agreement by clientRef and code and maps it to the domain model", async () => {
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

    const session = { fake: "session" };
    const result = await findByClientRefAndCode(
      "xnp-rr3-nfa",
      "pigs-might-fly",
      session,
    );

    expect(db.collection).toHaveBeenCalledWith(agreementsCollection);
    expect(findOne).toHaveBeenCalledWith(
      {
        "items.clientRef": "xnp-rr3-nfa",
        "items.agreementCode": "pigs-might-fly",
      },
      { session },
    );
    expect(result).toStrictEqual(testAgreement);
  });

  it("returns null when no agreement is found", async () => {
    db.collection.mockReturnValue({
      findOne: vi.fn().mockResolvedValueOnce(null),
    });

    const result = await findByClientRefAndCode(
      "unknown-client-ref",
      "pigs-might-fly",
    );

    expect(result).toBeNull();
  });
});

describe("findByClientRefCodeAndSbi", () => {
  it("finds an agreement by code, clientRef and sbi and maps it to the domain model", async () => {
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

    const session = { fake: "session" };
    const result = await findByClientRefCodeAndSbi(
      "xnp-rr3-nfa",
      "pigs-might-fly",
      "300000069",
      session,
    );

    expect(db.collection).toHaveBeenCalledWith(agreementsCollection);
    expect(findOne).toHaveBeenCalledWith(
      {
        items: {
          $elemMatch: {
            agreementCode: "pigs-might-fly",
            clientRef: "xnp-rr3-nfa",
          },
        },
        "identifiers.sbi": "300000069",
      },
      { session },
    );
    expect(result).toStrictEqual(testAgreement);
  });

  it("returns null when no agreement is found", async () => {
    db.collection.mockReturnValue({
      findOne: vi.fn().mockResolvedValueOnce(null),
    });

    const result = await findByClientRefCodeAndSbi(
      "unknown-client-ref",
      "pigs-might-fly",
      "unknown-sbi",
    );

    expect(result).toBeNull();
  });
});
