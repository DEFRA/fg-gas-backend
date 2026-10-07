import { describe, expect, it, vi } from "vitest";
import { ApplicationSeries } from "../models/application-series.js";
import { findSeriesByClientRefs } from "../repositories/application-series.repository.js";
import {
  countApplicationRows,
  findApplicationIdentifiers,
  findApplicationRowsByClientRefs,
  findApplicationRowsInSeries,
  findApplicationRowsPage,
  findApplicationSummaryRow,
  findStoredApplicationDocument,
} from "../repositories/application.repository.js";
import { findCodes } from "../repositories/grant.repository.js";
import {
  applicationExists,
  browseApplications,
  countApplications,
  findApplicationDocument,
  findApplicationSeries,
  findApplicationSummary,
  findApplicationsInSeriesOf,
  listGrantCodes,
} from "./application-read.service.js";

vi.mock("../repositories/application.repository.js");
vi.mock("../repositories/application-series.repository.js");
vi.mock("../repositories/grant.repository.js");

const POSITION = { phase: "PRE_AWARD", stage: "REVIEW", status: "RECEIVED" };

const aRow = (clientRef, code = "woodland") => ({
  clientRef,
  code,
  position: POSITION,
  createdAt: "2026-06-16T10:00:00.000Z",
});

const aSeries = (code, clientRefs) =>
  ApplicationSeries.fromDocument({
    code,
    clientRefs,
    latestClientRef: clientRefs.at(-1),
    latestClientId: "client-id",
    createdAt: "2026-06-16T10:00:00.000Z",
    updatedAt: "2026-06-16T10:00:00.000Z",
  });

describe("browseApplications", () => {
  it("answers one page of rows with the filters, each marked replaced or not", async () => {
    findApplicationRowsPage.mockResolvedValue({
      rows: [aRow("ref-2"), aRow("ref-1"), aRow("ref-1", "frps")],
      pagination: { endCursor: "c", hasNextPage: true },
    });
    findSeriesByClientRefs.mockResolvedValue([
      aSeries("woodland", ["ref-1", "ref-2"]),
    ]);

    const page = await browseApplications({
      code: "woodland",
      from: "2026-06-16T00:00:00.000Z",
      cursor: "abc",
      pageSize: 20,
    });

    expect(findApplicationRowsPage).toHaveBeenCalledWith({
      code: "woodland",
      from: "2026-06-16T00:00:00.000Z",
      to: undefined,
      cursor: "abc",
      pageSize: 20,
    });
    // A ref reused under another grant is a different application.
    expect(findSeriesByClientRefs).toHaveBeenCalledWith(["ref-2", "ref-1"]);
    expect(page).toEqual({
      rows: [
        { ...aRow("ref-2"), replaced: false },
        { ...aRow("ref-1"), replaced: true },
        { ...aRow("ref-1", "frps"), replaced: false },
      ],
      pagination: { endCursor: "c", hasNextPage: true },
    });
  });

  it("reads no series for an empty page", async () => {
    findApplicationRowsPage.mockResolvedValue({
      rows: [],
      pagination: { endCursor: null, hasNextPage: false },
    });

    expect((await browseApplications({ pageSize: 20 })).rows).toEqual([]);
    expect(findSeriesByClientRefs).not.toHaveBeenCalled();
  });
});

describe("findApplicationsInSeriesOf", () => {
  it("reads every member of the ref's series, under the grant when named, bounded one past 200", async () => {
    const series = [aSeries("woodland", ["ref-1", "ref-2"])];
    findSeriesByClientRefs.mockResolvedValue(series);
    findApplicationRowsInSeries.mockResolvedValue([
      aRow("ref-2"),
      aRow("ref-1"),
    ]);

    const page = await findApplicationsInSeriesOf({
      ref: "ref-1",
      code: "woodland",
      from: "2026-06-16T00:00:00.000Z",
    });

    expect(findSeriesByClientRefs).toHaveBeenCalledWith(["ref-1"], "woodland");
    expect(findApplicationRowsInSeries).toHaveBeenCalledWith({
      ref: "ref-1",
      series,
      code: "woodland",
      from: "2026-06-16T00:00:00.000Z",
      to: undefined,
      limit: 201,
    });
    expect(page).toEqual({
      rows: [
        { ...aRow("ref-2"), replaced: false },
        { ...aRow("ref-1"), replaced: true },
      ],
      total: { count: 2, capped: false },
    });
  });

  it("returns at most 200, capped, past the bound", async () => {
    findSeriesByClientRefs.mockResolvedValue([]);
    findApplicationRowsInSeries.mockResolvedValue(
      Array.from({ length: 201 }, (_, n) => aRow(`ref-${n}`)),
    );

    const page = await findApplicationsInSeriesOf({ ref: "ref-1" });

    expect(page.rows).toHaveLength(200);
    expect(page.total).toEqual({ count: 200, capped: true });
  });
});

describe("countApplications", () => {
  it("counts the browse filter up to one past 10,000", async () => {
    countApplicationRows.mockResolvedValue(42);

    expect(await countApplications({ code: "woodland" })).toEqual({
      count: 42,
      capped: false,
    });
    expect(countApplicationRows).toHaveBeenCalledWith(
      { code: "woodland", from: undefined, to: undefined },
      { limit: 10_001 },
    );
  });

  it("caps at 10,000", async () => {
    countApplicationRows.mockResolvedValue(10_001);

    expect(await countApplications({})).toEqual({
      count: 10_000,
      capped: true,
    });
  });
});

describe("findApplicationSummary and findApplicationDocument", () => {
  it("answers the summary row and its stored size", async () => {
    const found = { summary: { clientRef: "ref-1" }, storedBytes: 512 };
    findApplicationSummaryRow.mockResolvedValue(found);

    expect(
      await findApplicationSummary({ clientRef: "ref-1", code: "woodland" }),
    ).toBe(found);
    expect(findApplicationSummaryRow).toHaveBeenCalledWith({
      clientRef: "ref-1",
      code: "woodland",
    });
  });

  it("answers the stored document under the bound", async () => {
    const found = { storedBytes: 512, document: { storedBytes: "own" } };
    findStoredApplicationDocument.mockResolvedValue(found);

    expect(
      await findApplicationDocument(
        { clientRef: "ref-1", code: "woodland" },
        { maxBytes: 1024 },
      ),
    ).toBe(found);
    expect(findStoredApplicationDocument).toHaveBeenCalledWith(
      { clientRef: "ref-1", code: "woodland" },
      { maxBytes: 1024 },
    );
  });
});

describe("findApplicationSeries, applicationExists and listGrantCodes", () => {
  it("answers the application's own series under its grant, its members oldest first", async () => {
    findSeriesByClientRefs.mockResolvedValue([
      aSeries("woodland", ["a", "b", "c"]),
    ]);
    findApplicationRowsByClientRefs.mockResolvedValue([
      aRow("c"),
      aRow("a"),
      aRow("b"),
    ]);

    expect(
      await findApplicationSeries({ clientRef: "a", code: "woodland" }),
    ).toEqual({
      latestRef: "c",
      refs: ["a", "b", "c"],
      members: ["a", "b", "c"].map((clientRef) => ({
        clientRef,
        position: POSITION,
        createdAt: "2026-06-16T10:00:00.000Z",
      })),
    });
    expect(findSeriesByClientRefs).toHaveBeenCalledWith(["a"], "woodland");
    expect(findApplicationRowsByClientRefs).toHaveBeenCalledWith({
      clientRefs: ["a", "b", "c"],
      code: "woodland",
    });
  });

  it("keeps the slot of a member with no application, with no facts", async () => {
    findSeriesByClientRefs.mockResolvedValue([aSeries("woodland", ["a", "b"])]);
    findApplicationRowsByClientRefs.mockResolvedValue([aRow("b")]);

    const { members } = await findApplicationSeries({
      clientRef: "b",
      code: "woodland",
    });

    expect(members).toEqual([
      {
        clientRef: "a",
        position: { phase: null, stage: null, status: null },
        createdAt: null,
      },
      {
        clientRef: "b",
        position: POSITION,
        createdAt: "2026-06-16T10:00:00.000Z",
      },
    ]);
  });

  it("lists no members for a series of one, without reading them", async () => {
    findSeriesByClientRefs.mockResolvedValue([aSeries("woodland", ["a"])]);

    expect(
      await findApplicationSeries({ clientRef: "a", code: "woodland" }),
    ).toEqual({ latestRef: "a", refs: ["a"], members: [] });
    expect(findApplicationRowsByClientRefs).not.toHaveBeenCalled();
  });

  it("answers null where the application has no series", async () => {
    findSeriesByClientRefs.mockResolvedValue([]);

    expect(
      await findApplicationSeries({ clientRef: "a", code: "woodland" }),
    ).toBeNull();
  });

  it("says whether an application exists, with its identifiers", async () => {
    const identifiers = { sbi: "1", frn: null, crn: null };
    findApplicationIdentifiers.mockResolvedValueOnce(identifiers);
    findApplicationIdentifiers.mockResolvedValueOnce(null);

    expect(await applicationExists({ clientRef: "a", code: "b" })).toEqual({
      exists: true,
      identifiers,
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
