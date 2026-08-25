import { describe, expect, it } from "vitest";
import { resolvePageHref } from "./resolve-page-href.js";

describe("resolvePageHref", () => {
  it("returns a plain string href unchanged", async () => {
    const result = await resolvePageHref("#confirm", {});

    expect(result).toBe("#confirm");
  });

  it("resolves a templated href using jsonata refs against the given context", async () => {
    const href = {
      urlTemplate: "/{agreementNumber}/accept",
      params: { agreementNumber: "$.agreement.agreementNumber" },
    };

    const result = await resolvePageHref(href, {
      agreement: { agreementNumber: "PMF823153883" },
    });

    expect(result).toBe("/PMF823153883/accept");
  });

  it("throws when a template placeholder has no matching resolved param", async () => {
    const href = {
      urlTemplate: "/{agreementNumber}/accept",
      params: {},
    };

    await expect(resolvePageHref(href, {})).rejects.toThrow(
      'Unresolved param "agreementNumber" in href template "/{agreementNumber}/accept"',
    );
  });
});
