import { describe, expect, it } from "vitest";
import { endpoints, referenceData } from "./reference-data.js";

const items = [
  { code: "WINGS", description: "Wings" },
  { code: "ROCKET_PACK", description: "Rocket pack" },
];

const output = {
  items: {
    itemsRef: "$.response.options",
    items: { code: "@.id", description: "@.label" },
  },
};

const pmfReference = {
  code: "pmf-reference",
  method: "GET",
  service: "GRANT_FUNDING_CALCULATOR",
  path: "/reference/{name}",
  output,
};

describe("endpoints schema", () => {
  it("accepts an endpoint with and without a default output", () => {
    const { error } = endpoints.validate([
      pmfReference,
      {
        code: "pmf-breeds",
        method: "GET",
        service: "GRANT_FUNDING_CALCULATOR",
        path: "/breeds",
      },
    ]);

    expect(error).toBeUndefined();
  });

  it("refuses a repeated code", () => {
    const { error } = endpoints.validate([pmfReference, { ...pmfReference }]);

    expect(error.message).toMatch(/duplicate value/);
  });

  it("refuses a full URL in place of a named service", () => {
    const { error } = endpoints.validate([
      {
        code: "pmf-reference",
        method: "GET",
        path: "/reference/{name}",
        url: "https://fg-gss-pmf.%ENVIRONMENT%.cdp-int.defra.cloud/reference",
      },
    ]);

    expect(error.message).toMatch(/\.service" is required/);
  });
});

describe("referenceData schema", () => {
  it("accepts a set from each source", () => {
    const { error } = referenceData.validate([
      { name: "fly", source: { type: "endpoint", endpoint: "pmf-reference" } },
      {
        name: "breed",
        source: { type: "endpoint", endpoint: "pmf-breeds", output },
      },
      { name: "pig-colour", source: { type: "inline", items } },
      { name: "landing-site", source: { type: "db" } },
    ]);

    expect(error).toBeUndefined();
  });

  it("refuses a repeated name", () => {
    const { error } = referenceData.validate([
      { name: "fly", source: { type: "db" } },
      { name: "fly", source: { type: "db" } },
    ]);

    expect(error.message).toMatch(/duplicate value/);
  });

  it("refuses an unknown source type", () => {
    const { error } = referenceData.validate([
      { name: "fly", source: { type: "mongo" } },
    ]);

    expect(error.message).toMatch(
      /source.type" must be one of \[inline, db, endpoint\]/,
    );
  });

  it("refuses an endpoint written out in full rather than named", () => {
    const { error } = referenceData.validate([
      {
        name: "fly",
        source: {
          type: "endpoint",
          endpoint: { method: "GET", path: "/reference/fly", service: "PMF" },
          output,
        },
      },
    ]);

    expect(error.message).toMatch(/endpoint" must be a string/);
  });

  it("refuses inline items with a repeated code", () => {
    const { error } = referenceData.validate([
      {
        name: "fly",
        source: { type: "inline", items: [items[0], { ...items[0] }] },
      },
    ]);

    expect(error.message).toMatch(/duplicate value/);
  });
});
