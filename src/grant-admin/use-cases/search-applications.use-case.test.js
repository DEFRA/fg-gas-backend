import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  browseApplications,
  countApplications,
  findApplicationsInSeriesOf,
  listGrantCodes,
} from "../../grants/services/application-read.service.js";
import {
  buildSearchApplicationsAudit,
  searchApplicationsUseCase,
} from "./search-applications.use-case.js";

vi.mock("../../common/logger.js");
vi.mock("../../events/audited-read.js", () => ({
  auditedRead: (read) => read,
}));
vi.mock("../../grants/services/application-read.service.js");

const POSITION = { phase: "PRE_AWARD", stage: "REVIEW", status: "RECEIVED" };

const aRow = (clientRef, code = "woodland", replaced = false) => ({
  clientRef,
  code,
  position: POSITION,
  createdAt: "2026-06-16T10:00:00.000Z",
  replaced,
});

const PAGINATION = { endCursor: "next", hasNextPage: true };

describe("searchApplicationsUseCase", () => {
  beforeEach(() => {
    browseApplications.mockResolvedValue({
      rows: [aRow("ref-1")],
      pagination: PAGINATION,
    });
    findApplicationsInSeriesOf.mockResolvedValue({
      rows: [aRow("ref-2"), aRow("ref-1", "woodland", true)],
      total: { count: 2, capped: false },
    });
    countApplications.mockResolvedValue({ count: 10_000, capped: true });
    listGrantCodes.mockResolvedValue(["frps", "woodland"]);
  });

  it("browses 20 at a time with the page's filters", async () => {
    await searchApplicationsUseCase({
      code: "woodland",
      from: "2026-06-15T00:00:00.000Z",
      to: "2026-06-16T00:00:00.000Z",
    });

    expect(browseApplications).toHaveBeenCalledWith({
      ref: undefined,
      code: "woodland",
      from: "2026-06-15T00:00:00.000Z",
      to: "2026-06-16T00:00:00.000Z",
      cursor: undefined,
      pageSize: 20,
    });
    expect(findApplicationsInSeriesOf).not.toHaveBeenCalled();
  });

  it("answers a first browse page with its rows, the capped total and the grant codes", async () => {
    const page = await searchApplicationsUseCase({});

    expect(page).toEqual({
      rows: [
        {
          ref: { clientRef: "ref-1", code: "woodland" },
          position: POSITION,
          createdAt: "2026-06-16T10:00:00.000Z",
          replaced: false,
        },
      ],
      pagination: PAGINATION,
      total: { count: 10_000, capped: true },
      codes: ["frps", "woodland"],
      sourceErrors: [],
    });
    expect(countApplications).toHaveBeenCalledWith({
      ref: undefined,
      code: undefined,
      from: undefined,
      to: undefined,
      cursor: undefined,
    });
  });

  it("answers a later page with no total and no codes", async () => {
    const page = await searchApplicationsUseCase({ cursor: "abc" });

    expect(page).not.toHaveProperty("total");
    expect(page).not.toHaveProperty("codes");
    expect(countApplications).not.toHaveBeenCalled();
    expect(listGrantCodes).not.toHaveBeenCalled();
  });

  it("answers a ref search as one page, its total from its own read, not a count", async () => {
    const page = await searchApplicationsUseCase({
      ref: "ref-2",
      code: "woodland",
    });

    expect(findApplicationsInSeriesOf).toHaveBeenCalledWith({
      ref: "ref-2",
      code: "woodland",
      from: undefined,
      to: undefined,
      cursor: undefined,
    });
    expect(browseApplications).not.toHaveBeenCalled();
    expect(countApplications).not.toHaveBeenCalled();
    expect(page).toEqual({
      rows: [
        {
          ref: { clientRef: "ref-2", code: "woodland" },
          position: POSITION,
          createdAt: "2026-06-16T10:00:00.000Z",
          replaced: false,
        },
        {
          ref: { clientRef: "ref-1", code: "woodland" },
          position: POSITION,
          createdAt: "2026-06-16T10:00:00.000Z",
          replaced: true,
        },
      ],
      pagination: { endCursor: null, hasNextPage: false },
      total: { count: 2, capped: false },
      codes: ["frps", "woodland"],
      sourceErrors: [],
    });
  });
});

describe("buildSearchApplicationsAudit", () => {
  const result = { rows: [{}, {}], total: { count: 2, capped: false } };

  it("records a first browse page with its filters, count and total, and PMC 0706", () => {
    expect(
      buildSearchApplicationsAudit(
        {
          code: "woodland",
          from: "2026-06-15T00:00:00.000Z",
          to: "2026-06-16T00:00:00.000Z",
          caller: "admin-ui",
          repeat: false,
        },
        result,
      ),
    ).toEqual({
      entities: [
        {
          entity: "APPLICATION",
          action: "SEARCH_APPLICATIONS",
          entityid: "search",
        },
      ],
      details: {
        caller: "admin-ui",
        mode: "browse",
        code: "woodland",
        from: "2026-06-15T00:00:00.000Z",
        to: "2026-06-16T00:00:00.000Z",
        page: "first",
        resultCount: 2,
        total: { count: 2, capped: false },
      },
      accounts: { sbi: undefined, frn: undefined, crn: undefined },
      security: { pmccode: "0706" },
      segregationRef: "admin-search-applications",
    });
  });

  it("records a ref search as a search, never the ref", () => {
    const audit = buildSearchApplicationsAudit(
      { ref: "secret-ref", repeat: true },
      result,
    );

    expect(audit.details).toMatchObject({ mode: "search", repeat: true });
    expect(JSON.stringify(audit)).not.toContain("secret-ref");
  });

  it("records no repeat unless the search was repeated", () => {
    expect(
      buildSearchApplicationsAudit({ repeat: false }, result).details,
    ).not.toHaveProperty("repeat");
  });

  it("records a later page as next", () => {
    expect(
      buildSearchApplicationsAudit({ cursor: "abc" }, result).details.page,
    ).toBe("next");
  });

  it("records a failed read with no count", () => {
    const audit = buildSearchApplicationsAudit({}, null, new Error("boom"));

    expect(audit.details.resultCount).toBeUndefined();
  });
});
