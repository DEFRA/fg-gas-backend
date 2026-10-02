import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { findStoredByClientRefs } from "../repositories/application-series.repository.js";
import {
  countStored,
  findStored,
  findStoredDocument,
  findStoredIdentifiers,
  findStoredPage,
  findStoredSummary,
} from "../repositories/application.repository.js";
import { findCodes } from "../repositories/grant.repository.js";
import {
  applicationExists,
  countApplications,
  findApplicationDocument,
  findApplicationSeries,
  findApplicationSummary,
  findApplicationsPage,
  listGrantCodes,
} from "./grant-admin.service.js";

vi.mock("../repositories/application.repository.js");
vi.mock("../repositories/application-series.repository.js");
vi.mock("../repositories/grant.repository.js");

const aDoc = (clientRef, createdAt, overrides = {}) => ({
  _id: new ObjectId(),
  clientRef,
  code: "woodland",
  currentPhase: "PRE_AWARD",
  currentStage: "REVIEW",
  currentStatus: "RECEIVED",
  createdAt,
  ...overrides,
});

const POSITION = { phase: "PRE_AWARD", stage: "REVIEW", status: "RECEIVED" };

// Opacity: nothing Grant Admin reads, filters or counts names a path inside
// the grant-shaped answers.
const namesAnswers = (value) => /answers|phases/.test(JSON.stringify(value));

describe("findApplicationsPage browse", () => {
  beforeEach(() => {
    findStoredPage.mockResolvedValue({
      data: [aDoc("ref-1", "2026-06-16T10:00:00.000Z")],
      pagination: { endCursor: "c", hasNextPage: true },
    });
  });

  it("pages newest first over the grant and the created range, bounds in UTC", async () => {
    await findApplicationsPage({
      code: "woodland",
      from: "2026-06-16T00:00:00+01:00",
      to: "2026-06-16T23:59:59.999Z",
      cursor: "abc",
      pageSize: 20,
    });

    const options = findStoredPage.mock.calls[0][0];
    expect(options).toMatchObject({
      filter: {
        code: "woodland",
        createdAt: {
          $gte: "2026-06-15T23:00:00.000Z",
          $lte: "2026-06-16T23:59:59.999Z",
        },
      },
      cursor: "abc",
      pageSize: 20,
    });
    expect(namesAnswers(options)).toBe(false);
  });

  it("filters nothing with no filters", async () => {
    await findApplicationsPage({ pageSize: 20 });

    expect(findStoredPage.mock.calls[0][0].filter).toEqual({});
  });

  it("answers rows of refs, position and created time only", async () => {
    expect(await findApplicationsPage({ pageSize: 20 })).toEqual({
      rows: [
        {
          clientRef: "ref-1",
          code: "woodland",
          position: POSITION,
          createdAt: "2026-06-16T10:00:00.000Z",
        },
      ],
      pagination: { endCursor: "c", hasNextPage: true },
    });
  });
});

describe("findApplicationsPage search", () => {
  it("reads every member of each series holding the ref, plus the bare ref, in one unsorted bounded read", async () => {
    findStoredByClientRefs.mockResolvedValue([
      {
        code: "woodland",
        clientRefs: ["ref-1", "ref-2"],
        latestClientRef: "ref-2",
      },
      { code: "frps", clientRefs: ["ref-1"], latestClientRef: "ref-1" },
    ]);
    findStored.mockResolvedValue([]);

    await findApplicationsPage({
      ref: "ref-1",
      from: "2026-06-16T00:00:00.000Z",
    });

    expect(findStoredByClientRefs).toHaveBeenCalledWith(["ref-1"], undefined);
    const [filter, options] = findStored.mock.calls[0];
    expect(filter).toEqual({
      $or: [
        { code: "woodland", clientRef: { $in: ["ref-1", "ref-2"] } },
        { code: "frps", clientRef: { $in: ["ref-1"] } },
        { clientRef: "ref-1" },
      ],
      createdAt: { $gte: "2026-06-16T00:00:00.000Z" },
    });
    expect(options.limit).toBe(201);
    expect(options).not.toHaveProperty("sort");
  });

  it("narrows the series and the match to the grant", async () => {
    findStoredByClientRefs.mockResolvedValue([]);
    findStored.mockResolvedValue([]);

    await findApplicationsPage({ ref: "ref-1", code: "woodland" });

    expect(findStoredByClientRefs).toHaveBeenCalledWith(["ref-1"], "woodland");
    expect(findStored.mock.calls[0][0].code).toBe("woodland");
  });

  it("answers the chain newest first, ties broken by id, as one page with its own total", async () => {
    const [a, b] = [
      new ObjectId("aaaaaaaaaaaaaaaaaaaaaaaa"),
      new ObjectId("bbbbbbbbbbbbbbbbbbbbbbbb"),
    ];
    findStoredByClientRefs.mockResolvedValue([]);
    findStored.mockResolvedValue([
      aDoc("old", "2026-06-14T10:00:00.000Z"),
      aDoc("tie-a", "2026-06-16T10:00:00.000Z", { _id: a }),
      aDoc("tie-b", "2026-06-16T10:00:00.000Z", { _id: b }),
    ]);

    const page = await findApplicationsPage({ ref: "old" });

    expect(page.rows.map((row) => row.clientRef)).toEqual([
      "tie-b",
      "tie-a",
      "old",
    ]);
    expect(page.pagination).toEqual({ endCursor: null, hasNextPage: false });
    expect(page.total).toEqual({ count: 3, capped: false });
  });

  it("orders a legacy Date or missing created time without failing", async () => {
    findStoredByClientRefs.mockResolvedValue([]);
    findStored.mockResolvedValue([
      aDoc("missing", undefined),
      aDoc("date", new Date("2026-06-16T10:00:00.000Z")),
      aDoc("string", "2026-06-15T10:00:00.000Z"),
    ]);

    const page = await findApplicationsPage({ ref: "date" });

    expect(page.rows.map((row) => row.clientRef)).toEqual([
      "date",
      "string",
      "missing",
    ]);
    expect(page.rows[0].createdAt).toBe("2026-06-16T10:00:00.000Z");
  });

  it("returns at most 200, capped, past the bound", async () => {
    findStoredByClientRefs.mockResolvedValue([]);
    findStored.mockResolvedValue(
      Array.from({ length: 201 }, (_, n) =>
        aDoc(`ref-${n}`, new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString()),
      ),
    );

    const page = await findApplicationsPage({ ref: "ref-1" });

    expect(page.rows).toHaveLength(200);
    expect(page.total).toEqual({ count: 200, capped: true });
  });
});

describe("countApplications", () => {
  it("counts the browse filter up to one past 10,000", async () => {
    countStored.mockResolvedValue(42);

    expect(await countApplications({ code: "woodland" })).toEqual({
      count: 42,
      capped: false,
    });
    expect(countStored).toHaveBeenCalledWith({ code: "woodland" }, 10_001);
  });

  it("caps at 10,000", async () => {
    countStored.mockResolvedValue(10_001);

    expect(await countApplications({})).toEqual({
      count: 10_000,
      capped: true,
    });
  });
});

describe("findApplicationSummary", () => {
  const stored = {
    clientRef: "ref-1",
    code: "woodland",
    currentPhase: "PRE_AWARD",
    configVersion: "0.9.0",
    submittedAt: new Date("2026-06-16T09:00:00.000Z"),
    createdAt: "2026-06-16T10:00:00.000Z",
    identifiers: { sbi: "123456789" },
    storedBytes: 512,
  };

  it("projects the summary fields only, none inside answers or metadata", async () => {
    findStoredSummary.mockResolvedValue(stored);

    await findApplicationSummary({ clientRef: "ref-1", code: "woodland" });

    const [key, projection] = findStoredSummary.mock.calls[0];
    expect(key).toEqual({ clientRef: "ref-1", code: "woodland" });
    expect(namesAnswers(projection)).toBe(false);
    expect(projection).not.toHaveProperty("metadata");
  });

  it("maps a legacy document's facts, falling back to its single config version", async () => {
    findStoredSummary.mockResolvedValue(stored);

    expect(
      await findApplicationSummary({ clientRef: "ref-1", code: "woodland" }),
    ).toEqual({
      summary: {
        clientRef: "ref-1",
        code: "woodland",
        position: { phase: "PRE_AWARD", stage: null, status: null },
        originalConfigVersion: "0.9.0",
        currentConfigVersion: "0.9.0",
        submittedAt: "2026-06-16T09:00:00.000Z",
        createdAt: "2026-06-16T10:00:00.000Z",
        updatedAt: null,
        identifiers: { sbi: "123456789", frn: null, crn: null },
      },
      storedBytes: 512,
    });
  });

  it("answers null for no such application", async () => {
    findStoredSummary.mockResolvedValue(null);

    expect(
      await findApplicationSummary({ clientRef: "x", code: "y" }),
    ).toBeNull();
  });
});

describe("findApplicationDocument", () => {
  const document = {
    _id: new ObjectId(),
    clientRef: "ref-1",
    code: "woodland",
    metadata: { defraId: "d-1" },
    phases: [{ code: "PRE_AWARD", answers: { a: 1 } }],
  };

  it("answers the document exactly as stored, and its size", async () => {
    findStoredDocument.mockResolvedValue({
      storedBytes: 512,
      document: { ...document, storedBytes: 512 },
    });

    expect(
      await findApplicationDocument(
        { clientRef: "ref-1", code: "woodland" },
        { maxBytes: 1024 },
      ),
    ).toEqual({ storedBytes: 512, document });
    expect(findStoredDocument).toHaveBeenCalledWith(
      { clientRef: "ref-1", code: "woodland" },
      1024,
    );
  });

  it("answers only the size of a document over the bound", async () => {
    findStoredDocument.mockResolvedValue({ storedBytes: 2048 });

    expect(
      await findApplicationDocument(
        { clientRef: "ref-1", code: "woodland" },
        { maxBytes: 1024 },
      ),
    ).toEqual({ storedBytes: 2048, document: null });
  });

  it("answers null for no such application", async () => {
    findStoredDocument.mockResolvedValue(null);

    expect(
      await findApplicationDocument(
        { clientRef: "x", code: "y" },
        { maxBytes: 1 },
      ),
    ).toBeNull();
  });
});

describe("findApplicationSeries, applicationExists and listGrantCodes", () => {
  it("maps each series to its code, refs and latest ref", async () => {
    findStoredByClientRefs.mockResolvedValue([
      { code: "woodland", clientRefs: ["a", "b"], latestClientRef: "b" },
    ]);

    expect(
      await findApplicationSeries({ clientRefs: ["a"], code: "woodland" }),
    ).toEqual([{ code: "woodland", refs: ["a", "b"], latestRef: "b" }]);
    expect(findStoredByClientRefs).toHaveBeenCalledWith(["a"], "woodland");
  });

  it("says whether an application exists, with its identifiers", async () => {
    findStoredIdentifiers.mockResolvedValueOnce({ identifiers: { sbi: "1" } });
    findStoredIdentifiers.mockResolvedValueOnce(null);

    expect(await applicationExists({ clientRef: "a", code: "b" })).toEqual({
      exists: true,
      identifiers: { sbi: "1", frn: null, crn: null },
    });
    expect(await applicationExists({ clientRef: "a", code: "b" })).toEqual({
      exists: false,
      identifiers: null,
    });
  });

  it("lists the grant codes in order", async () => {
    findCodes.mockResolvedValue(["woodland", "frps"]);

    expect(await listGrantCodes()).toEqual(["frps", "woodland"]);
  });
});
