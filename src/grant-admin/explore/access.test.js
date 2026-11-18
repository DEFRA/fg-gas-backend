import { describe, expect, it } from "vitest";
import { mayQuery, rolesOf } from "./access.js";

describe("rolesOf", () => {
  it.each([
    ["devops, finance ,", ["devops", "finance"]],
    [undefined, null],
  ])("reads %s", (header, roles) => {
    expect(rolesOf(header)).toEqual(roles);
  });
});

describe("mayQuery", () => {
  it.each([
    [{ requires: null }, null, true],
    [{}, null, true],
    [{ requires: "finance" }, null, false],
    [{ requires: "finance" }, ["devops"], false],
    [{ requires: "finance" }, ["finance"], true],
  ])("%j for %j: %s", (source, roles, may) => {
    expect(mayQuery(source, roles)).toBe(may);
  });
});
