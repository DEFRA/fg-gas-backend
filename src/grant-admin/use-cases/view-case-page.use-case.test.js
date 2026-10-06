import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../common/logger.js";
import { applicationExists } from "../../grants/services/application-read.service.js";
import { findCwCase } from "../repositories/cw-actuators.repository.js";
import { readCaseworkingPage } from "./caseworking-page.helpers.js";
import { findEventsUseCase } from "./find-events.use-case.js";
import {
  buildViewCaseAudit,
  viewCasePageUseCase,
} from "./view-case-page.use-case.js";

vi.mock("../../common/logger.js");
vi.mock("../../events/audited-read.js", () => ({
  auditedRead: (read) => read,
}));
vi.mock("../../grants/services/application-read.service.js");
vi.mock("../repositories/cw-actuators.repository.js");
vi.mock("./find-events.use-case.js");
vi.mock("./caseworking-page.helpers.js");

const KEY = { workflowCode: "frps-private-beta", caseRef: "ref-1" };

const SUMMARY = {
  caseRef: "ref-1",
  workflowCode: "frps-private-beta",
  position: { phase: "PRE_AWARD", stage: "REVIEW", status: "RECEIVED" },
  closed: true,
  closedAt: "2026-06-18T10:00:00.000Z",
  createdAt: "2026-06-16T10:00:00.000Z",
  originalConfigVersion: "1.0.0",
  currentConfigVersion: "1.1.0",
  series: { latestRef: "ref-1", refs: ["ref-0", "ref-1"] },
};

const DOCUMENT = { caseRef: "ref-1", payload: { anything: [1] } };

const view = (tab) =>
  viewCasePageUseCase({ ...KEY, tab, caller: "admin-ui", actor: "Jo" });

describe("viewCasePageUseCase", () => {
  beforeEach(() => {
    findCwCase.mockImplementation(async (_key, { include }) => ({
      summary: SUMMARY,
      storedBytes: 4096,
      document: include ? DOCUMENT : null,
    }));
    applicationExists.mockResolvedValue({ exists: true, identifiers: {} });
    findEventsUseCase.mockResolvedValue({
      events: [],
      pagination: { hasNextPage: false },
      sourceErrors: [],
    });
  });

  it("draws every tab", async () => {
    for (const tab of ["overview", "events", "raw"]) {
      expect((await view(tab)).header.caseRef).toBe("ref-1");
    }
  });

  it.each([
    ["overview", undefined],
    ["events", undefined],
    ["raw", "document"],
  ])("reads Caseworking once for the %s tab", async (tab, include) => {
    await view(tab);

    expect(findCwCase).toHaveBeenCalledTimes(1);
    expect(findCwCase).toHaveBeenCalledWith(KEY, { actor: "Jo", include });
  });

  it("overview: the trimmed facts, the series and the stored size", async () => {
    expect((await view("overview")).overview).toEqual({
      workflowCode: "frps-private-beta",
      originalConfigVersion: "1.0.0",
      currentConfigVersion: "1.1.0",
      createdAt: "2026-06-16T10:00:00.000Z",
      closed: true,
      closedAt: "2026-06-18T10:00:00.000Z",
      series: SUMMARY.series,
      storedBytes: 4096,
    });
  });

  it("events: the rows for the case ref, audit rows left out", async () => {
    await view("events");

    expect(readCaseworkingPage).toHaveBeenCalledWith({
      q: "ref-1",
      audit: "exclude",
      sections: ["list"],
    });
    expect(findEventsUseCase).toHaveBeenCalledWith(
      expect.objectContaining({ q: "ref-1", audit: "exclude" }),
    );
  });

  it("raw: Caseworking's document with its size, logged without a ref", async () => {
    const page = await view("raw");

    expect(page.raw).toEqual(DOCUMENT);
    expect(page.storedBytes).toBe(4096);
    expect(logger.info).toHaveBeenCalledWith("Read case document: 4096 bytes");
  });

  it("raw: a document over the read limit is too large to show, the header still drawn", async () => {
    findCwCase.mockResolvedValue({
      summary: SUMMARY,
      storedBytes: 5_000_000,
      document: null,
      tooLarge: true,
    });

    const page = await view("raw");

    expect(page.header.caseRef).toBe("ref-1");
    expect(page.raw).toBeNull();
    expect(page.storedBytes).toBe(5_000_000);
    expect(page.sectionErrors).toEqual([
      { section: "raw", message: "too large to show" },
    ]);
  });

  it.each([
    [404, Boom.notFound("case not found")],
    [504, Boom.gatewayTimeout("CW-BE cases did not answer in time")],
    [502, Boom.badGateway("CW-BE cases unavailable: HTTP 500")],
  ])("answers %i with Caseworking's failure", async (status, error) => {
    findCwCase.mockRejectedValue(error);

    const failure = await view("overview").catch((e) => e);

    expect(failure.output.statusCode).toBe(status);
  });
});

describe("buildViewCaseAudit", () => {
  it("records the tab and workflow, the application's identifiers and PMC 0706", () => {
    expect(
      buildViewCaseAudit({
        ...KEY,
        tab: "raw",
        caller: "admin-ui",
        accounts: { sbi: "106284736" },
      }),
    ).toEqual({
      entities: [
        { entity: "CASE", action: "VIEW_CASE_DATA", entityid: "ref-1" },
      ],
      details: {
        caller: "admin-ui",
        workflowCode: "frps-private-beta",
        tab: "raw",
      },
      accounts: { sbi: "106284736", frn: undefined, crn: undefined },
      security: { pmccode: "0706" },
      segregationRef: "admin-view-case",
    });
  });

  it("records an orphan case with no accounts", () => {
    expect(
      buildViewCaseAudit({ ...KEY, tab: "overview", accounts: undefined })
        .accounts,
    ).toEqual({ sbi: undefined, frn: undefined, crn: undefined });
  });
});
