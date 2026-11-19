import { describe, expect, it } from "vitest";
import { callerMayQuery } from "./explore-access.js";

const FINANCE = { requires: "finance" };

describe("callerMayQuery", () => {
  it.each([
    [{ roles: "devops, finance" }, true],
    [{ roles: "devops" }, false],
    [{}, false],
  ])("%j: %s", (args, may) => {
    expect(callerMayQuery(args)(FINANCE)).toBe(may);
  });

  it("lets any caller query a source that needs no role", () => {
    expect(callerMayQuery({})({ requires: null })).toBe(true);
  });
});
