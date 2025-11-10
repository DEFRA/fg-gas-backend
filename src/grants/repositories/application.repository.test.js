import Boom from "@hapi/boom";
import { MongoServerError } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { db } from "../../common/mongo-client.js";
import {
  Agreement,
  AgreementHistoryEntry,
  AgreementStatus,
} from "../models/agreement.js";
import { ApplicationDocument } from "../models/application-document.js";
import {
  Application,
  ApplicationPhase,
  ApplicationStage,
  ApplicationStatus,
} from "../models/application.js";
import {
  findByClientRef,
  findByClientRefAndCode,
  save,
  update,
} from "./application.repository.js";

vi.mock("../../common/mongo-client.js");

describe("update", () => {
  it("should update application", async () => {
    const application = new ApplicationDocument({
      clientRef: "application-1",
      code: "grant-1",
      createdAt: "2021-01-02T00:00:00.000Z",
      submittedAt: "2021-01-01T00:00:00.000Z",
      identifiers: {
        sbi: "sbi-1",
        frn: "frn-1",
        crn: "crn-1",
        defraId: "defraId-1",
      },
      answers: {
        anything: "test",
      },
      agreements: {},
    });

    const replaceOne = vi.fn().mockResolvedValueOnce({
      modifiedCount: 1,
    });
    db.collection.mockReturnValue({
      replaceOne,
    });

    await update(application);

    expect(replaceOne).toHaveBeenCalled();
    expect(replaceOne.mock.calls[0][1]).toBeInstanceOf(ApplicationDocument);
  });

  it("should throw if record not modified", async () => {
    const application = new ApplicationDocument({
      clientRef: "application-1",
      code: "grant-1",
      createdAt: "2021-01-02T00:00:00.000Z",
      submittedAt: "2021-01-01T00:00:00.000Z",
      identifiers: {
        sbi: "sbi-1",
        frn: "frn-1",
        crn: "crn-1",
        defraId: "defraId-1",
      },
      answers: {
        anything: "test",
      },
    });

    const replaceOne = vi.fn().mockResolvedValueOnce({
      modifiedCount: 0,
    });
    db.collection.mockReturnValue({
      replaceOne,
    });

    await expect(() => update(application)).rejects.toThrow(
      'Failed to update application with clientRef "application-1" and code "grant-1"',
    );
  });
});

describe("save", () => {
  it("stores an application", async () => {
    const insertOne = vi.fn().mockResolvedValueOnce({
      insertedId: "1",
    });

    const session = {};

    db.collection.mockReturnValue({
      insertOne,
    });

    await save(
      new Application({
        currentPhase: ApplicationPhase.PreAward,
        currentStage: ApplicationStage.Assessment,
        currentStatus: ApplicationStatus.Received,
        clientRef: "application-1",
        code: "grant-1",
        createdAt: "2021-01-01T00:00:00.000Z",
        updatedAt: "2021-01-01T01:00:00.000Z",
        submittedAt: "2021-01-01T00:00:00.000Z",
        identifiers: {
          sbi: "sbi-1",
          frn: "frn-1",
          crn: "crn-1",
          defraId: "defraId-1",
        },
        answers: {
          anything: "test",
        },
      }),
      session,
    );

    expect(db.collection).toHaveBeenCalledWith("applications");

    expect(insertOne).toHaveBeenCalledWith(
      new ApplicationDocument({
        currentPhase: ApplicationPhase.PreAward,
        currentStage: ApplicationStage.Assessment,
        currentStatus: ApplicationStatus.Received,
        clientRef: "application-1",
        code: "grant-1",
        createdAt: "2021-01-01T00:00:00.000Z",
        updatedAt: "2021-01-01T01:00:00.000Z",
        submittedAt: "2021-01-01T00:00:00.000Z",
        identifiers: {
          sbi: "sbi-1",
          frn: "frn-1",
          crn: "crn-1",
          defraId: "defraId-1",
        },
        answers: {
          anything: "test",
        },
      }),

      { session },
    );
  });

  it("throws Boom.conflict when an application with same clientRef exists", async () => {
    const error = new MongoServerError("E11000 duplicate key error collection");
    error.code = 11000;

    db.collection.mockReturnValue({
      insertOne: vi.fn().mockRejectedValueOnce(error),
    });

    await expect(
      save(
        new Application({
          clientRef: "application-1",
          code: "grant-1",
          createdAt: "2021-01-01T00:00:00.000Z",
          submittedAt: "2021-01-01T00:00:00.000Z",
          identifiers: {
            sbi: "sbi-1",
            frn: "frn-1",
            crn: "crn-1",
            defraId: "defraId-1",
          },
          answers: {
            anything: "test",
          },
        }),
      ),
    ).rejects.toThrow(
      Boom.conflict('Application with clientRef "application-1" exists'),
    );
  });

  it("throws when an error occurs", async () => {
    const error = new Error("test");

    db.collection.mockReturnValue({
      insertOne: vi.fn().mockRejectedValueOnce(error),
    });

    await expect(
      save(
        new Application({
          clientRef: "application-1",
          code: "grant-1",
          currentPhase: "PRE_AWARD",
          currentStage: "application",
          status: "PENDING",
          createdAt: "2021-01-01T00:00:00.000Z",
          submittedAt: "2021-01-01T00:00:00.000Z",
          identifiers: {
            sbi: "sbi-1",
            frn: "frn-1",
            crn: "crn-1",
            defraId: "defraId-1",
          },
          answers: {
            anything: "test",
          },
        }),
      ),
    ).rejects.toThrow(error);
  });
});

describe("findByClientRef", () => {
  it("finds an application by clientRef", async () => {
    const findOne = vi.fn().mockResolvedValueOnce(
      new ApplicationDocument({
        clientRef: "application-1",
        code: "grant-1",
        createdAt: "2021-01-02T00:00:00.000Z",
        submittedAt: "2021-01-01T00:00:00.000Z",
        identifiers: {
          sbi: "sbi-1",
          frn: "frn-1",
          crn: "crn-1",
          defraId: "defraId-1",
        },
        answers: {
          anything: "test",
        },
        agreements: {},
      }),
    );

    db.collection.mockReturnValue({
      findOne,
    });

    const result = await findByClientRef("application-1");

    expect(result).toStrictEqual(
      new Application({
        clientRef: "application-1",
        code: "grant-1",
        createdAt: "2021-01-02T00:00:00.000Z",
        submittedAt: "2021-01-01T00:00:00.000Z",
        identifiers: {
          sbi: "sbi-1",
          frn: "frn-1",
          crn: "crn-1",
          defraId: "defraId-1",
        },
        answers: {
          anything: "test",
        },
        agreements: {},
      }),
    );

    expect(db.collection).toHaveBeenCalledWith("applications");

    expect(findOne).toHaveBeenCalledWith({
      clientRef: "application-1",
    });
  });

  it("returns null when application not found", async () => {
    db.collection.mockReturnValue({
      findOne: vi.fn().mockResolvedValueOnce(null),
    });

    const result = await findByClientRef("non-existent-client-ref");

    expect(result).toBeNull();
  });
});

describe("findByClientRefAndCode", () => {
  it("finds an application by clientRef and code", async () => {
    const findOne = vi.fn().mockResolvedValueOnce(
      new ApplicationDocument({
        currentPhase: ApplicationPhase.PreAward,
        currentStage: ApplicationStage.Assessment,
        currentStatus: ApplicationStatus.Received,
        clientRef: "application-1",
        code: "grant-1",
        createdAt: "2021-01-02T00:00:00.000Z",
        submittedAt: "2021-01-01T00:00:00.000Z",
        identifiers: {
          sbi: "sbi-1",
          frn: "frn-1",
          crn: "crn-1",
          defraId: "defraId-1",
        },
        answers: {
          anything: "test",
        },
        agreements: {
          "agreement-1": {
            agreementRef: "agreement-1",
            updatedAt: "2021-01-01T00:00:00.000Z",
            latestStatus: AgreementStatus.Offered,
            history: [
              {
                agreementStatus: AgreementStatus.Offered,
                createdAt: "2021-01-01T00:00:00.000Z",
              },
            ],
          },
        },
      }),
    );

    db.collection.mockReturnValue({
      findOne,
    });

    const result = await findByClientRefAndCode({
      clientRef: "application-1",
      code: "grant-1",
    });

    expect(result).toStrictEqual(
      new Application({
        currentPhase: ApplicationPhase.PreAward,
        currentStage: ApplicationStage.Assessment,
        currentStatus: ApplicationStatus.Received,
        clientRef: "application-1",
        code: "grant-1",
        createdAt: "2021-01-02T00:00:00.000Z",
        submittedAt: "2021-01-01T00:00:00.000Z",
        identifiers: {
          sbi: "sbi-1",
          frn: "frn-1",
          crn: "crn-1",
          defraId: "defraId-1",
        },
        answers: {
          anything: "test",
        },
        agreements: {
          "agreement-1": new Agreement({
            agreementRef: "agreement-1",
            updatedAt: "2021-01-01T00:00:00.000Z",
            latestStatus: AgreementStatus.Offered,
            history: [
              new AgreementHistoryEntry({
                agreementStatus: AgreementStatus.Offered,
                createdAt: "2021-01-01T00:00:00.000Z",
              }),
            ],
          }),
        },
      }),
    );

    expect(db.collection).toHaveBeenCalledWith("applications");

    expect(findOne).toHaveBeenCalledWith(
      {
        clientRef: "application-1",
        code: "grant-1",
      },
      {},
    );
  });

  it("returns null when application not found", async () => {
    db.collection.mockReturnValue({
      findOne: vi.fn().mockResolvedValueOnce(null),
    });

    const result = await findByClientRefAndCode({
      clientRef: "non-existent-client-ref",
      code: "grant-1",
    });

    expect(result).toBeNull();
  });
});
