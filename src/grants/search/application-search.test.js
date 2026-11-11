import { describe, expect, it, vi } from "vitest";
import { findCurrentSearches } from "../repositories/grant.repository.js";
import { applicationSearch } from "./application-search.js";
import { applicationViewOf } from "./application-view.js";

vi.mock("../repositories/grant.repository.js");

describe("applicationSearch", () => {
  it("indexes applications by grant code into application_search", () => {
    expect(applicationSearch).toMatchObject({
      collection: "application_search",
      records: "applications",
      lead: "code",
      projection: { phases: 1 },
    });
  });

  it("reads each code's declaration from its current grant version", async () => {
    findCurrentSearches.mockResolvedValue([{ value: "grant-a", search: null }]);

    expect([
      ...(await applicationSearch.declarations.current()).keys(),
    ]).toEqual(["grant-a"]);
    expect(findCurrentSearches).toHaveBeenCalled();
  });
});

describe("applicationViewOf", () => {
  it("is the answers merged across phases, a later phase winning", () => {
    expect(
      applicationViewOf({
        phases: [
          { code: "PRE_AWARD", answers: { business: { name: "First" }, a: 1 } },
          { code: "POST_AGREEMENT", answers: { business: { name: "Later" } } },
          { code: "EMPTY" },
        ],
      }),
    ).toEqual({ answers: { business: { name: "Later" }, a: 1 } });
  });

  it("is no answers for no phases", () => {
    expect(applicationViewOf({})).toEqual({ answers: {} });
  });
});
