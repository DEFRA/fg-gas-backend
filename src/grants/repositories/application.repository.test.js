import Boom from "@hapi/boom";
import { MongoServerError } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { db } from "../../common/mongo-client.js";
import { paginate } from "../../common/paginate.js";
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
import { ApplicationSeries } from "../models/application-series.js";
import {
  countApplicationRows,
  findApplicationIdentifiers,
  findApplicationRowsByClientRefs,
  findApplicationRowsInSeries,
  findApplicationRowsPage,
  findApplicationSummaryRow,
  findByClientRef,
  findByClientRefAndCode,
  findStoredApplicationDocument,
  lockForUpdate,
  save,
  update,
} from "./application.repository.js";

vi.mock("../../common/mongo-client.js");
vi.mock("../../common/paginate.js");

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
      },
      metadata: {
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
      },
      metadata: {
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
        configVersion: "1.0.0",
        createdAt: "2021-01-01T00:00:00.000Z",
        updatedAt: "2021-01-01T01:00:00.000Z",
        submittedAt: "2021-01-01T00:00:00.000Z",
        identifiers: {
          sbi: "sbi-1",
          frn: "frn-1",
          crn: "crn-1",
        },
        metadata: {
          defraId: "defraId-1",
        },
        answers: {
          anything: "test",
        },
        phases: [],
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
        originalConfigVersion: "1.0.0",
        currentConfigVersion: "1.0.0",
        createdAt: "2021-01-01T00:00:00.000Z",
        updatedAt: "2021-01-01T01:00:00.000Z",
        submittedAt: "2021-01-01T00:00:00.000Z",
        identifiers: {
          sbi: "sbi-1",
          frn: "frn-1",
          crn: "crn-1",
        },
        metadata: {
          defraId: "defraId-1",
        },
        answers: {
          anything: "test",
        },
        phases: [],
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
          phases: [],
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
          phases: [],
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
        },
        metadata: {
          defraId: "defraId-1",
        },
        answers: {
          anything: "test",
        },
        agreements: {},
        phases: [],
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
        },
        metadata: {
          defraId: "defraId-1",
        },
        answers: {
          anything: "test",
        },
        agreements: {},
        phases: [],
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
        },
        metadata: {
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
        phases: [],
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
        },
        metadata: {
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
        phases: [],
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

  it("defaults identifiers, metadata and agreements when missing", async () => {
    const findOne = vi.fn().mockResolvedValueOnce({
      currentPhase: ApplicationPhase.PreAward,
      currentStage: ApplicationStage.Assessment,
      currentStatus: ApplicationStatus.Received,
      clientRef: "application-1",
      code: "grant-1",
      createdAt: "2021-01-02T00:00:00.000Z",
      updatedAt: "2021-01-02T00:00:00.000Z",
      submittedAt: "2021-01-01T00:00:00.000Z",
      phases: [],
      // identifiers/metadata/agreements intentionally missing
    });

    db.collection.mockReturnValue({
      findOne,
    });

    const result = await findByClientRefAndCode({
      clientRef: "application-1",
      code: "grant-1",
    });

    expect(result.identifiers).toEqual({});
    expect(result.metadata).toEqual({});
    expect(result.agreements).toEqual({});
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

describe("lockForUpdate", () => {
  it("returns the locked application", async () => {
    const session = {};
    const findOneAndUpdate = vi.fn().mockResolvedValueOnce({
      clientRef: "application-1",
      code: "grant-1",
      currentPhase: ApplicationPhase.PreAward,
      currentStage: ApplicationStage.Assessment,
      currentStatus: ApplicationStatus.Received,
      phases: [],
    });
    db.collection.mockReturnValue({ findOneAndUpdate });

    const result = await lockForUpdate(
      { clientRef: "application-1", code: "grant-1" },
      session,
    );

    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { clientRef: "application-1", code: "grant-1" },
      { $inc: { claimSubmissionLockVersion: 1 } },
      { session, returnDocument: "after" },
    );
    expect(result.clientRef).toBe("application-1");
    expect(result.code).toBe("grant-1");
  });

  it("returns null when the application does not exist", async () => {
    db.collection.mockReturnValue({
      findOneAndUpdate: vi.fn().mockResolvedValueOnce(null),
    });

    const result = await lockForUpdate({
      clientRef: "missing",
      code: "grant-1",
    });

    expect(result).toBeNull();
  });
});

// Opacity: nothing Grant Admin reads, filters or counts names a path inside
// the grant-shaped answers.
const namesAnswers = (value) => /answers|phases/.test(JSON.stringify(value));

const aStoredRow = (clientRef) => ({
  _id: "id",
  clientRef,
  code: "woodland",
  currentPhase: "PRE_AWARD",
  currentStage: "REVIEW",
  currentStatus: "RECEIVED",
  createdAt: "2026-06-16T10:00:00.000Z",
});

const ROW = (clientRef) => ({
  clientRef,
  code: "woodland",
  position: { phase: "PRE_AWARD", stage: "REVIEW", status: "RECEIVED" },
  createdAt: "2026-06-16T10:00:00.000Z",
});

describe("findApplicationRowsPage", () => {
  it("pages newest first over the grant and the created range, bounds in UTC", async () => {
    db.collection.mockReturnValue("applications");
    paginate.mockResolvedValue({
      data: [aStoredRow("ref-1")],
      pagination: { endCursor: "c", hasNextPage: true },
    });

    const page = await findApplicationRowsPage({
      code: "woodland",
      from: "2026-06-16T00:00:00+01:00",
      to: "2026-06-16T23:59:59.999Z",
      cursor: "abc",
      pageSize: 20,
    });

    const [, options] = paginate.mock.calls[0];
    expect(options).toMatchObject({
      filter: {
        code: "woodland",
        createdAt: {
          $gte: "2026-06-15T23:00:00.000Z",
          $lte: "2026-06-16T23:59:59.999Z",
        },
      },
      sort: { createdAt: -1, _id: -1 },
      cursor: "abc",
      pageSize: 20,
    });
    expect(namesAnswers(options)).toBe(false);
    expect(page).toEqual({
      rows: [ROW("ref-1")],
      pagination: { endCursor: "c", hasNextPage: true },
    });
  });

  it("filters nothing with no filters", async () => {
    paginate.mockResolvedValue({ data: [], pagination: {} });

    await findApplicationRowsPage({ pageSize: 20 });

    expect(paginate.mock.calls[0][1].filter).toEqual({});
  });
});

describe("findApplicationRowsInSeries", () => {
  it("reads each series member and the bare ref, newest first, hinted onto {clientRef, code}", async () => {
    const toArray = vi.fn().mockResolvedValue([aStoredRow("ref-2")]);
    const find = vi.fn().mockReturnValue({ toArray });
    db.collection.mockReturnValue({ find });
    const series = [
      ApplicationSeries.fromDocument({
        code: "woodland",
        clientRefs: ["ref-1", "ref-2"],
        latestClientRef: "ref-2",
        latestClientId: "client-id",
        createdAt: "2026-06-16T10:00:00.000Z",
        updatedAt: "2026-06-16T10:00:00.000Z",
      }),
    ];

    const rows = await findApplicationRowsInSeries({
      ref: "ref-1",
      series,
      from: "2026-06-16T00:00:00.000Z",
      limit: 201,
    });

    const [filter, options] = find.mock.calls[0];
    expect(filter).toEqual({
      $or: [
        { code: "woodland", clientRef: { $in: ["ref-1", "ref-2"] } },
        { clientRef: "ref-1" },
      ],
      createdAt: { $gte: "2026-06-16T00:00:00.000Z" },
    });
    expect(options).toMatchObject({
      sort: { createdAt: -1, _id: -1 },
      limit: 201,
      hint: { clientRef: 1, code: 1 },
    });
    expect(namesAnswers(options)).toBe(false);
    expect(rows).toEqual([ROW("ref-2")]);
  });
});

describe("findApplicationRowsByClientRefs", () => {
  it("reads the named applications of one grant by {clientRef, code}", async () => {
    const toArray = vi
      .fn()
      .mockResolvedValue([aStoredRow("ref-2"), aStoredRow("ref-1")]);
    const find = vi.fn().mockReturnValue({ toArray });
    db.collection.mockReturnValue({ find });

    const rows = await findApplicationRowsByClientRefs({
      clientRefs: ["ref-1", "ref-2"],
      code: "woodland",
    });

    const [filter, options] = find.mock.calls[0];
    expect(filter).toEqual({
      clientRef: { $in: ["ref-1", "ref-2"] },
      code: "woodland",
    });
    expect(options.hint).toEqual({ clientRef: 1, code: 1 });
    expect(namesAnswers(options)).toBe(false);
    expect(rows).toEqual([ROW("ref-2"), ROW("ref-1")]);
  });
});

describe("countApplicationRows", () => {
  it("counts the browse filter up to the limit", async () => {
    const countDocuments = vi.fn().mockResolvedValue(42);
    db.collection.mockReturnValue({ countDocuments });

    expect(
      await countApplicationRows({ code: "woodland" }, { limit: 10_001 }),
    ).toBe(42);
    expect(countDocuments).toHaveBeenCalledWith(
      { code: "woodland" },
      expect.objectContaining({ limit: 10_001 }),
    );
  });
});

describe("findApplicationSummaryRow", () => {
  const aggregating = (docs) => {
    const aggregate = vi.fn().mockReturnValue({ toArray: async () => docs });
    db.collection.mockReturnValue({ aggregate });
    return aggregate;
  };

  it("projects the summary fields and the stored size only, none inside answers or metadata", async () => {
    const aggregate = aggregating([
      { ...aStoredRow("ref-1"), storedBytes: 512 },
    ]);

    const found = await findApplicationSummaryRow({
      clientRef: "ref-1",
      code: "woodland",
    });

    const [pipeline] = aggregate.mock.calls[0];
    expect(pipeline[0]).toEqual({
      $match: { clientRef: "ref-1", code: "woodland" },
    });
    expect(namesAnswers(pipeline)).toBe(false);
    expect(pipeline[1].$project).not.toHaveProperty("metadata");
    expect(found.storedBytes).toBe(512);
    expect(found.summary.clientRef).toBe("ref-1");
    expect(found.summary).not.toHaveProperty("storedBytes");
  });

  it("answers null for no such application", async () => {
    aggregating([]);

    expect(
      await findApplicationSummaryRow({ clientRef: "x", code: "y" }),
    ).toBeNull();
  });
});

describe("findStoredApplicationDocument", () => {
  const aggregating = (docs) => {
    const aggregate = vi.fn().mockReturnValue({ toArray: async () => docs });
    db.collection.mockReturnValue({ aggregate });
    return aggregate;
  };

  it("answers the document as stored beside its size, never setting a field on it", async () => {
    const document = { clientRef: "ref-1", storedBytes: "the document's own" };
    const aggregate = aggregating([{ storedBytes: 512, document }]);

    expect(
      await findStoredApplicationDocument(
        { clientRef: "ref-1", code: "woodland" },
        { maxBytes: 1024 },
      ),
    ).toEqual({ storedBytes: 512, document });
    expect(JSON.stringify(aggregate.mock.calls[0][0])).not.toContain("$set");
  });

  it("answers only the size of a document over the bound", async () => {
    aggregating([{ storedBytes: 2048 }]);

    expect(
      await findStoredApplicationDocument(
        { clientRef: "ref-1", code: "woodland" },
        { maxBytes: 1024 },
      ),
    ).toEqual({ storedBytes: 2048, document: null });
  });

  it("answers null for no such application", async () => {
    aggregating([]);

    expect(
      await findStoredApplicationDocument(
        { clientRef: "x", code: "y" },
        { maxBytes: 1 },
      ),
    ).toBeNull();
  });
});

describe("findApplicationIdentifiers", () => {
  it("answers the identifiers, or null for no such application", async () => {
    const findOne = vi
      .fn()
      .mockResolvedValueOnce({ identifiers: { sbi: "1" } })
      .mockResolvedValueOnce(null);
    db.collection.mockReturnValue({ findOne });

    expect(
      await findApplicationIdentifiers({ clientRef: "a", code: "b" }),
    ).toEqual({ sbi: "1", frn: null, crn: null });
    expect(
      await findApplicationIdentifiers({ clientRef: "a", code: "b" }),
    ).toBeNull();
  });
});

describe("the application summary read model", () => {
  const summaryOf = async (doc) => {
    const aggregate = vi.fn().mockReturnValue({
      toArray: async () => [{ ...doc, storedBytes: 1 }],
    });
    db.collection.mockReturnValue({ aggregate });

    return (await findApplicationSummaryRow({ clientRef: "ref-1", code: "c" }))
      .summary;
  };

  const DOC = {
    clientRef: "ref-1",
    code: "woodland",
    currentPhase: "PRE_AWARD",
    createdAt: "2026-06-16T10:00:00.000Z",
    identifiers: { sbi: "123456789" },
  };

  it("maps a legacy document's facts, falling back to its single config version", async () => {
    expect(
      await summaryOf({
        ...DOC,
        configVersion: "0.9.0",
        submittedAt: new Date("2026-06-16T09:00:00.000Z"),
      }),
    ).toEqual({
      clientRef: "ref-1",
      code: "woodland",
      position: { phase: "PRE_AWARD", stage: null, status: null },
      originalConfigVersion: "0.9.0",
      currentConfigVersion: "0.9.0",
      submittedAt: "2026-06-16T09:00:00.000Z",
      createdAt: "2026-06-16T10:00:00.000Z",
      updatedAt: null,
      identifiers: { sbi: "123456789", frn: null, crn: null },
    });
  });

  it("prefers the split config versions over the legacy one", async () => {
    expect(
      await summaryOf({
        ...DOC,
        originalConfigVersion: "1.0.0",
        currentConfigVersion: "1.2.0",
        configVersion: "0.9.0",
      }),
    ).toMatchObject({
      originalConfigVersion: "1.0.0",
      currentConfigVersion: "1.2.0",
    });
  });

  it.each([
    ["an unparsable string", "not-an-instant", "not-an-instant"],
    [
      "a string with an offset",
      "2026-06-16T10:00:00+01:00",
      "2026-06-16T10:00:00+01:00",
    ],
    ["an empty string", "", ""],
    ["a number", 1_750_000_000_000, "1750000000000"],
    ["an invalid Date", new Date(Number.NaN), "Invalid Date"],
  ])(
    "shows %s submitted or updated time as stored",
    async (_name, value, shown) => {
      const summary = await summaryOf({
        ...DOC,
        submittedAt: value,
        updatedAt: value,
      });

      expect(summary.submittedAt).toBe(shown);
      expect(summary.updatedAt).toBe(shown);
    },
  );
});
