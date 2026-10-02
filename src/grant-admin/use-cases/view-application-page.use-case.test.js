import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../common/logger.js";
import {
  findApplicationDocument,
  findApplicationSeries,
  findApplicationSummary,
} from "../../grants/services/grant-admin.service.js";
import { readCaseworkingPage } from "../services/event-sources.js";
import { findEventsUseCase } from "./find-events.use-case.js";
import {
  APPLICATION_TABS,
  buildViewApplicationAudit,
  viewApplicationPageUseCase,
} from "./view-application-page.use-case.js";

vi.mock("../../common/logger.js");
// The audit itself is the factory's; these tests read through it.
vi.mock("../../events/audited-read.js", () => ({
  auditedRead: (read) => read,
}));
vi.mock("../../grants/services/grant-admin.service.js");
vi.mock("./find-events.use-case.js");
vi.mock("../services/event-sources.js", async (importOriginal) => ({
  ...(await importOriginal()),
  readCaseworkingPage: vi.fn(),
}));

const REF = { clientRef: "ref-1", code: "woodland" };

const SUMMARY = {
  ...REF,
  position: { phase: "PRE_AWARD", stage: "REVIEW", status: "RECEIVED" },
  originalConfigVersion: "1.0.0",
  currentConfigVersion: "1.2.0",
  submittedAt: "2026-06-16T10:00:00.000Z",
  createdAt: "2026-06-16T10:00:01.000Z",
  updatedAt: "2026-06-16T10:05:00.000Z",
  identifiers: { sbi: "123456789", frn: "1234567890", crn: null },
};

const view = (tab) =>
  viewApplicationPageUseCase({ ...REF, tab, caller: "admin-ui" });

describe("viewApplicationPageUseCase", () => {
  beforeEach(() => {
    findApplicationSummary.mockResolvedValue({
      summary: SUMMARY,
      storedBytes: 2048,
    });
    findApplicationSeries.mockResolvedValue([]);
  });

  it("has exactly the overview, events and raw tabs", () => {
    expect(Object.keys(APPLICATION_TABS)).toEqual([
      "overview",
      "events",
      "raw",
    ]);
  });

  it("overview: the trimmed facts, the series with this code and the stored size", async () => {
    findApplicationSeries.mockResolvedValue([
      { code: "woodland", latestRef: "ref-2", refs: ["ref-1", "ref-2"] },
    ]);

    const page = await view("overview");

    expect(findApplicationSeries).toHaveBeenCalledWith({
      clientRefs: ["ref-1"],
      code: "woodland",
    });
    expect(page.overview).toEqual({
      code: "woodland",
      originalConfigVersion: "1.0.0",
      currentConfigVersion: "1.2.0",
      submittedAt: "2026-06-16T10:00:00.000Z",
      createdAt: "2026-06-16T10:00:01.000Z",
      updatedAt: "2026-06-16T10:05:00.000Z",
      identifiers: SUMMARY.identifiers,
      series: { latestRef: "ref-2", refs: ["ref-1", "ref-2"] },
      storedBytes: 2048,
    });
  });

  it("overview: a null series where the application has none", async () => {
    expect((await view("overview")).overview.series).toBeNull();
  });

  it("every tab draws the header with the case link unknown", async () => {
    for (const tab of Object.keys(APPLICATION_TABS)) {
      findEventsUseCase.mockResolvedValue({
        events: [],
        pagination: { hasNextPage: false },
        sourceErrors: [],
      });

      expect((await view(tab)).header).toMatchObject({
        ...REF,
        position: SUMMARY.position,
        counterpart: null,
      });
    }
  });

  it("events: GAS and Caseworking rows for the ref, audit rows left out, through one Caseworking read", async () => {
    const caseworking = Promise.resolve({});
    readCaseworkingPage.mockReturnValue(caseworking);
    findEventsUseCase.mockResolvedValue({
      events: [{ id: "row-1" }],
      pagination: { hasNextPage: true },
      sourceErrors: [
        { key: "cwOutbox", service: "caseworking", box: "outbox" },
      ],
    });

    const page = await view("events");

    expect(readCaseworkingPage).toHaveBeenCalledWith({
      q: "ref-1",
      audit: "exclude",
      sections: ["list"],
    });
    expect(findEventsUseCase).toHaveBeenCalledWith({
      q: "ref-1",
      audit: "exclude",
      caseworking,
    });
    expect(page.events).toEqual({ rows: [{ id: "row-1" }], more: true });
    expect(page.sourceErrors).toEqual([{ hop: "CW-BE Outbox" }]);
  });

  it("raw: the whole stored document with its size, logged without a ref", async () => {
    const id = new ObjectId();
    const document = {
      _id: id,
      ...REF,
      phases: [{ code: "PRE_AWARD", answers: { anything: [1, 2] } }],
    };
    findApplicationDocument.mockResolvedValue({ document, storedBytes: 2048 });

    const page = await view("raw");

    expect(findApplicationDocument).toHaveBeenCalledWith(REF, {
      maxBytes: 1024 * 1024,
    });
    expect(page.raw).toEqual(document);
    expect(page.storedBytes).toBe(2048);
    expect(page.sectionErrors).toEqual([]);
    expect(logger.info).toHaveBeenCalledWith(
      "Read application document: 2048 bytes",
    );
  });

  it("raw: too large to show, from its stored size, without the document", async () => {
    findApplicationDocument.mockResolvedValue({
      document: null,
      storedBytes: 2 * 1024 * 1024,
    });

    const page = await view("raw");

    expect(page.raw).toBeNull();
    expect(page.storedBytes).toBe(2 * 1024 * 1024);
    expect(page.sectionErrors).toEqual([
      { section: "raw", message: "too large to show" },
    ]);
  });

  it("only the raw tab reads the whole document", async () => {
    await view("overview");
    await view("events");

    expect(findApplicationDocument).not.toHaveBeenCalled();
  });

  it("answers 404 when the application does not exist", async () => {
    findApplicationSummary.mockResolvedValue(null);

    await expect(view("overview")).rejects.toMatchObject({
      output: { statusCode: 404 },
    });
  });
});

describe("buildViewApplicationAudit", () => {
  const args = {
    ...REF,
    tab: "raw",
    caller: "admin-ui",
    accounts: SUMMARY.identifiers,
  };

  it("records the tab, the code and the application's identifiers, with PMC 0706", () => {
    expect(buildViewApplicationAudit(args)).toEqual({
      entities: [
        {
          entity: "APPLICATION",
          action: "VIEW_APPLICATION",
          entityid: "ref-1",
        },
      ],
      details: { caller: "admin-ui", code: "woodland", tab: "raw" },
      accounts: SUMMARY.identifiers,
      security: { pmccode: "0706" },
      segregationRef: "admin-view-application",
    });
  });

  it("records a refused view with no accounts", () => {
    const audit = buildViewApplicationAudit(
      { ...args, accounts: undefined },
      new Error("application not found"),
    );

    expect(audit.accounts).toEqual({
      sbi: undefined,
      frn: undefined,
      crn: undefined,
    });
    expect(audit.details.tab).toBe("raw");
  });
});
