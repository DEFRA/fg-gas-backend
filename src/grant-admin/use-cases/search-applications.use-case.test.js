import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  countApplications,
  findApplicationSeries,
  findApplicationsPage,
  listGrantCodes,
} from "../../grants/services/grant-admin.service.js";
import {
  buildSearchApplicationsAudit,
  searchApplicationsUseCase,
} from "./search-applications.use-case.js";

vi.mock("../../common/logger.js");
vi.mock("../../events/audited-read.js", () => ({
  auditedRead: (read) => read,
}));
vi.mock("../../grants/services/grant-admin.service.js");

const POSITION = { phase: "PRE_AWARD", stage: "REVIEW", status: "RECEIVED" };

const aRow = (clientRef, code = "woodland") => ({
  clientRef,
  code,
  position: POSITION,
  createdAt: "2026-06-16T10:00:00.000Z",
});

const PAGINATION = { endCursor: "next", hasNextPage: true };

describe("searchApplicationsUseCase", () => {
  beforeEach(() => {
    findApplicationsPage.mockResolvedValue({
      rows: [aRow("ref-1")],
      pagination: PAGINATION,
    });
    findApplicationSeries.mockResolvedValue([]);
    countApplications.mockResolvedValue({ count: 10_000, capped: true });
    listGrantCodes.mockResolvedValue(["frps", "woodland"]);
  });

  it("browses 20 at a time with the page's filters", async () => {
    await searchApplicationsUseCase({
      code: "woodland",
      from: "2026-06-15T00:00:00.000Z",
      to: "2026-06-16T00:00:00.000Z",
    });

    expect(findApplicationsPage).toHaveBeenCalledWith({
      ref: undefined,
      code: "woodland",
      from: "2026-06-15T00:00:00.000Z",
      to: "2026-06-16T00:00:00.000Z",
      cursor: undefined,
      pageSize: 20,
    });
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

  it("takes a ref search's total from its own read, not a count", async () => {
    findApplicationsPage.mockResolvedValue({
      rows: [aRow("ref-3"), aRow("ref-2"), aRow("ref-1")],
      pagination: { endCursor: null, hasNextPage: false },
      total: { count: 3, capped: false },
    });

    const page = await searchApplicationsUseCase({ ref: "ref-2" });

    expect(countApplications).not.toHaveBeenCalled();
    expect(page.total).toEqual({ count: 3, capped: false });
  });

  it("marks replaced the rows a later ref in the same grant's series superseded, from one series read", async () => {
    findApplicationsPage.mockResolvedValue({
      rows: [
        aRow("ref-3"),
        aRow("ref-2"),
        aRow("ref-1"),
        aRow("ref-1", "frps"),
      ],
      pagination: { endCursor: null, hasNextPage: false },
      total: { count: 4, capped: false },
    });
    findApplicationSeries.mockResolvedValue([
      {
        code: "woodland",
        latestRef: "ref-3",
        refs: ["ref-1", "ref-2", "ref-3"],
      },
    ]);

    const page = await searchApplicationsUseCase({ ref: "ref-2" });

    expect(findApplicationSeries).toHaveBeenCalledTimes(1);
    expect(findApplicationSeries).toHaveBeenCalledWith({
      clientRefs: ["ref-3", "ref-2", "ref-1"],
    });
    expect(
      page.rows.map((row) => [row.ref.code, row.ref.clientRef, row.replaced]),
    ).toEqual([
      ["woodland", "ref-3", false],
      ["woodland", "ref-2", true],
      ["woodland", "ref-1", true],
      ["frps", "ref-1", false],
    ]);
  });

  it("reads no series for an empty page", async () => {
    findApplicationsPage.mockResolvedValue({
      rows: [],
      pagination: { endCursor: null, hasNextPage: false },
    });

    expect((await searchApplicationsUseCase({ cursor: "abc" })).rows).toEqual(
      [],
    );
    expect(findApplicationSeries).not.toHaveBeenCalled();
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
        repeat: false,
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
