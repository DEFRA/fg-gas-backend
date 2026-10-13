import { describe, expect, it, vi } from "vitest";
import { ApplicationSeries } from "../models/application-series.js";
import { findSeriesByClientRefs } from "../repositories/application-series.repository.js";
import {
  findApplicationIdentifiers,
  findApplicationRowsByClientRefs,
  findApplicationSummaryRow,
  findStoredApplicationDocument,
} from "../repositories/application.repository.js";
import {
  applicationExists,
  findApplicationDocument,
  findApplicationSeries,
  findApplicationSummary,
} from "./application-read.service.js";

vi.mock("../repositories/application.repository.js");
vi.mock("../repositories/application-series.repository.js");

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

describe("findApplicationSeries and applicationExists", () => {
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
});
