import { describe, expect, it } from "vitest";
import { resolveActions, resolvePageHref } from "./resolve-page-href.js";

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

describe("resolveActions", () => {
  it("resolves each complete action affordance against the context", async () => {
    const actions = [
      {
        name: "continue",
        method: "GET",
        text: "Continue",
        href: "#confirm",
      },
      {
        name: "accept",
        method: "POST",
        text: "Accept",
        href: {
          urlTemplate: "/{agreementNumber}/accept",
          params: { agreementNumber: "$.agreement.agreementNumber" },
        },
      },
    ];

    const result = await resolveActions(
      { agreement: { agreementNumber: "PMF823153883" } },
      actions,
    );

    expect(result).toEqual([
      {
        name: "continue",
        method: "GET",
        text: "Continue",
        href: "#confirm",
      },
      {
        name: "accept",
        method: "POST",
        text: "Accept",
        href: "/PMF823153883/accept",
      },
    ]);
  });

  it("returns an empty array when no actions are given", async () => {
    const result = await resolveActions({});

    expect(result).toEqual([]);
  });
});
