import { describe, expect, it } from "vitest";
import { referenceData } from "./reference-data.js";

const items = [
  { code: "WINGS", description: "Wings" },
  { code: "ROCKET_PACK", description: "Rocket pack" },
  { code: "GLIDERS", description: "Gliders" },
];

const endpointSource = {
  type: "endpoint",
  endpoint: {
    method: "GET",
    path: "/reference/fly",
    service: "GRANT_FUNDING_CALCULATOR",
  },
  output: {
    items: {
      itemsRef: "$.response.options",
      items: { code: "@.id", description: "@.label" },
    },
  },
};

describe("referenceData schema", () => {
  it("accepts a set from each source", () => {
    const { error } = referenceData.validate([
      { name: "fly-inline", source: { type: "inline", items } },
      { name: "fly-db", source: { type: "db" } },
      { name: "fly-endpoint", source: endpointSource },
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

  it("refuses a full URL in place of a named service", () => {
    const { error } = referenceData.validate([
      {
        name: "fly",
        source: {
          ...endpointSource,
          endpoint: {
            method: "GET",
            path: "/reference/fly",
            url: "https://fg-gss-pmf.%ENVIRONMENT%.cdp-int.defra.cloud/reference/fly",
          },
        },
      },
    ]);

    expect(error.message).toMatch(/endpoint.service" is required/);
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
