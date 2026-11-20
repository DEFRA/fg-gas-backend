import { describe, expect, it } from "vitest";
import { createTestGrant } from "../../../test/helpers/grants.js";

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

const pmfBreeds = {
  code: "pmf-breeds",
  method: "GET",
  service: "GRANT_FUNDING_CALCULATOR",
  path: "/breeds",
};

const breedOutput = {
  items: {
    itemsRef: "$.response.breeds",
    items: { code: "@.code", description: "@.name" },
  },
};

const grantWith = (referenceData, endpoints = [pmfReference, pmfBreeds]) =>
  createTestGrant({ endpoints, referenceData });

describe("Grant reference data", () => {
  it("has none unless it declares some", () => {
    const grant = createTestGrant();

    expect(grant.referenceData).toEqual([]);
    expect(grant.endpoints).toEqual([]);
  });

  it("finds a declared set by name", () => {
    const grant = grantWith([
      { name: "landing-site", source: { type: "db" } },
      {
        name: "pig-colour",
        source: {
          type: "inline",
          items: [{ code: "PINK", description: "Pink" }],
        },
      },
    ]);

    expect(grant.findReferenceData("pig-colour").type).toBe("inline");
    expect(grant.findReferenceData("missing")).toBeUndefined();
  });

  it("refuses a name declared twice", () => {
    expect(() =>
      grantWith([
        { name: "fly", source: { type: "db" } },
        { name: "fly", source: { type: "db" } },
      ]),
    ).toThrow(
      'Grant "test-grant" declares reference data "fly" more than once',
    );
  });

  describe("endpoint sets", () => {
    it("share an endpoint, each reading its own path and the endpoint's output", () => {
      const grant = grantWith([
        {
          name: "fly",
          source: { type: "endpoint", endpoint: "pmf-reference" },
        },
        {
          name: "wingspan",
          source: { type: "endpoint", endpoint: "pmf-reference" },
        },
      ]);

      expect(
        grant.referenceDataCallFor(grant.findReferenceData("wingspan")),
      ).toEqual({
        endpoint: {
          method: "GET",
          path: "/reference/wingspan",
          service: "GRANT_FUNDING_CALCULATOR",
        },
        output,
      });
    });

    it("use their own output over the endpoint's", () => {
      const grant = grantWith([
        {
          name: "breed",
          source: {
            type: "endpoint",
            endpoint: "pmf-breeds",
            output: breedOutput,
          },
        },
      ]);

      expect(
        grant.referenceDataCallFor(grant.findReferenceData("breed")),
      ).toMatchObject({ endpoint: { path: "/breeds" }, output: breedOutput });
    });

    it("refuse an endpoint the grant does not declare", () => {
      expect(() =>
        grantWith([
          {
            name: "fly",
            source: { type: "endpoint", endpoint: "pmf-refrence" },
          },
        ]),
      ).toThrow(
        'reference data "fly" names endpoint "pmf-refrence", which it does not declare',
      );
    });

    it("refuse a set with no output when its endpoint has none", () => {
      expect(() =>
        grantWith([
          {
            name: "breed",
            source: { type: "endpoint", endpoint: "pmf-breeds" },
          },
        ]),
      ).toThrow(
        'reference data "breed" has no output, and endpoint "pmf-breeds" has none to share',
      );
    });

    it("refuse an endpoint code declared twice", () => {
      expect(() => grantWith([], [pmfReference, { ...pmfReference }])).toThrow(
        'Grant "test-grant" declares endpoint "pmf-reference" more than once',
      );
    });

    it("refuse an endpoint whose default output cannot resolve", () => {
      expect(() =>
        grantWith(
          [],
          [{ ...pmfReference, output: { items: { itemsRef: "$.response" } } }],
        ),
      ).toThrow(/Endpoint "pmf-reference" output items mapping is invalid/);
    });
  });
});
