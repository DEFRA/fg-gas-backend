import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../common/logger.js";
import {
  findApplicationDocument,
  findApplicationSeries,
  findApplicationSummary,
} from "../../grants/services/application-read.service.js";
import { findCwCaseExistence } from "../repositories/cw-actuators.repository.js";
import { readApplicationEventsUseCase } from "./read-record-events.use-case.js";
import {
  buildViewApplicationAudit,
  viewApplicationPageUseCase,
} from "./view-application-page.use-case.js";

vi.mock("../../common/logger.js");
const audit = vi.hoisted(() => ({ builder: null }));
vi.mock("../../events/audited-read.js", () => ({
  auditedRead: (read, builder) => {
    audit.builder = builder;
    return read;
  },
}));
vi.mock("../../grants/services/application-read.service.js");
vi.mock("./read-record-events.use-case.js");
vi.mock("../repositories/cw-actuators.repository.js");

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
  viewApplicationPageUseCase({
    ...REF,
    tab,
    caller: "admin-ui",
  });

describe("viewApplicationPageUseCase", () => {
  beforeEach(() => {
    findApplicationSummary.mockResolvedValue({
      summary: SUMMARY,
      storedBytes: 2048,
    });
    findApplicationSeries.mockResolvedValue(null);
    findCwCaseExistence.mockResolvedValue({ exists: true });
  });

  it("is audited as a read that releases data", () => {
    expect(audit.builder).toEqual(expect.any(Function));
  });

  it("audits with the tab and the header's accounts, which never reach the page", async () => {
    const page = await view("overview");

    expect(page).not.toHaveProperty("accounts");
    expect(
      audit.builder(
        { ...REF, tab: "overview" },
        { accounts: SUMMARY.identifiers },
      ).accounts,
    ).toEqual(SUMMARY.identifiers);
  });

  it("audits a failure with no accounts", () => {
    expect(
      audit.builder({ ...REF, tab: "overview" }, null, new Error("x")).accounts,
    ).toEqual({ sbi: undefined, frn: undefined, crn: undefined });
  });

  it("overview: the trimmed facts, the series with this code and the stored size", async () => {
    const series = {
      latestRef: "ref-2",
      refs: ["ref-1", "ref-2"],
      members: [
        {
          clientRef: "ref-1",
          position: SUMMARY.position,
          createdAt: "2026-06-16T10:00:01.000Z",
        },
        {
          clientRef: "ref-2",
          position: SUMMARY.position,
          createdAt: "2026-06-17T10:00:00.000Z",
        },
      ],
    };
    findApplicationSeries.mockResolvedValue(series);

    const page = await view("overview");

    expect(findApplicationSeries).toHaveBeenCalledWith({
      clientRef: "ref-1",
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
      series,
      storedBytes: 2048,
    });
  });

  it("overview: a null series where the application has none", async () => {
    expect((await view("overview")).overview.series).toBeNull();
  });

  it("overview draws the header with its case link", async () => {
    expect((await view("overview")).header).toMatchObject({
      ...REF,
      position: SUMMARY.position,
      counterpart: { exists: true },
    });
  });

  it.each(["events", "raw"])(
    "%s draws the header without asking Caseworking for the case link",
    async (tab) => {
      readApplicationEventsUseCase.mockResolvedValue({
        content: { events: { rows: [], more: false } },
        sourceErrors: [],
      });
      findApplicationDocument.mockResolvedValue({
        document: { ...REF },
        storedBytes: 100,
      });

      expect((await view(tab)).header).toMatchObject({
        ...REF,
        position: SUMMARY.position,
        counterpart: null,
      });
      expect(findCwCaseExistence).not.toHaveBeenCalled();
    },
  );

  it("events: the timeline of the application's ref, from this service alone", async () => {
    readApplicationEventsUseCase.mockResolvedValue({
      content: { events: { rows: [{ id: "row-1" }], more: true } },
      sourceErrors: [{ hop: "GAS outbox" }],
    });

    const page = await view("events");

    expect(readApplicationEventsUseCase).toHaveBeenCalledWith({ ref: "ref-1" });
    expect(page.events).toEqual({ rows: [{ id: "row-1" }], more: true });
    expect(page.sourceErrors).toEqual([{ hop: "GAS outbox" }]);
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
