import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { searchCwCases } from "../repositories/cw-actuators.repository.js";
import {
  buildSearchCasesAudit,
  searchCasesUseCase,
} from "./search-cases.use-case.js";

vi.mock("../../common/logger.js");
vi.mock("../../events/audited-read.js", () => ({
  auditedRead: (read) => read,
}));
vi.mock("../repositories/cw-actuators.repository.js");

const POSITION = { phase: "PRE_AWARD", stage: "REVIEW", status: "RECEIVED" };

const aCase = (caseRef) => ({
  ref: { caseRef, workflowCode: "frps-private-beta" },
  position: POSITION,
  closed: true,
  closedAt: "2026-06-17T10:00:00.000Z",
  createdAt: "2026-06-16T10:00:00.000Z",
  replaced: false,
});

describe("searchCasesUseCase", () => {
  beforeEach(() => {
    searchCwCases.mockResolvedValue({
      rows: [aCase("ref-1")],
      pagination: { endCursor: "c", hasNextPage: true },
      total: { count: 10_000, capped: true },
      workflowCodes: ["frps-private-beta"],
    });
  });

  it("reads one page from Caseworking with the filters, the operator and the repeat flag", async () => {
    await searchCasesUseCase({
      workflowCode: "frps-private-beta",
      from: "2026-06-15T00:00:00.000Z",
      cursor: "abc",
      actor: "Jo",
      repeat: true,
      caller: "admin-ui",
    });

    expect(searchCwCases).toHaveBeenCalledWith(
      {
        ref: undefined,
        workflowCode: "frps-private-beta",
        from: "2026-06-15T00:00:00.000Z",
        to: undefined,
        cursor: "abc",
      },
      { actor: "Jo", repeat: true },
    );
  });

  it("answers Caseworking's rows, the total and the workflow codes", async () => {
    expect(await searchCasesUseCase({})).toEqual({
      rows: [aCase("ref-1")],
      pagination: { endCursor: "c", hasNextPage: true },
      total: { count: 10_000, capped: true },
      workflowCodes: ["frps-private-beta"],
      sourceErrors: [],
    });
  });

  it("answers no total or codes where Caseworking gave none", async () => {
    searchCwCases.mockResolvedValue({
      rows: [],
      pagination: { endCursor: null, hasNextPage: false },
    });

    const page = await searchCasesUseCase({ cursor: "abc" });

    expect(page).not.toHaveProperty("total");
    expect(page).not.toHaveProperty("workflowCodes");
  });

  it("fails with the adapter's own failure", async () => {
    const refused = Boom.badRequest("CW-BE refused the case query");
    searchCwCases.mockRejectedValue(refused);

    await expect(searchCasesUseCase({ cursor: "stale" })).rejects.toBe(refused);
  });
});

describe("buildSearchCasesAudit", () => {
  it("records the page as a CASE search with PMC 0706, never the ref", () => {
    const audit = buildSearchCasesAudit(
      { ref: "secret-ref", caller: "admin-ui", repeat: false },
      { rows: [{}], total: { count: 1, capped: false } },
    );

    expect(audit).toMatchObject({
      entities: [
        { entity: "CASE", action: "SEARCH_CASES", entityid: "search" },
      ],
      details: {
        mode: "search",
        page: "first",
        resultCount: 1,
        total: { count: 1, capped: false },
      },
      security: { pmccode: "0706" },
      segregationRef: "admin-search-cases",
    });
    expect(JSON.stringify(audit)).not.toContain("secret-ref");
    expect(audit.details).not.toHaveProperty("repeat");
  });

  it("records a repeated search", () => {
    expect(
      buildSearchCasesAudit({ ref: "r", repeat: true }, null).details.repeat,
    ).toBe(true);
  });

  it("records the workflow filter and a later page", () => {
    expect(
      buildSearchCasesAudit({ workflowCode: "woodland", cursor: "c" }, null)
        .details,
    ).toMatchObject({ mode: "browse", workflowCode: "woodland", page: "next" });
  });
});
