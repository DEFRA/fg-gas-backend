import { describe, expect, it } from "vitest";
import { pages } from "./pages.js";

const banner = {
  title: {
    text: "$.answers.applicant.business.name",
    type: "string",
  },
  summary: {
    scheme: {
      label: "Scheme",
      text: "Woodland Management Plan",
      type: "string",
    },
    sbi: { label: "SBI", text: "$.identifiers.sbi", type: "string" },
  },
};

const definition = (overrides = {}) => ({
  claims: { details: { banner: { ...banner, ...overrides } } },
});

const validate = (value) => pages.validate(value);

describe("pages", () => {
  it("accepts a claims banner", () => {
    const { error, value } = validate(definition());

    expect(error).toBeUndefined();
    expect(value.claims.details.banner.title.text).toBe(
      "$.answers.applicant.business.name",
    );
  });

  // The three forms resolveRefs reads: a lone reference, a jsonata expression
  // and text that never varies.
  it.each([
    ["a reference", "$.identifiers.sbi"],
    ["a jsonata expression", "jsonata:$.clientRef & ' (' & $.code & ')'"],
    ["literal text", "Woodland Management Plan"],
  ])("accepts %s as a value", (_, text) => {
    const { error } = validate(definition({ title: { text, type: "string" } }));

    expect(error).toBeUndefined();
  });

  it("accepts a page carrying no summary", () => {
    const { error } = validate({
      claims: { details: { banner: { title: banner.title } } },
    });

    expect(error).toBeUndefined();
  });

  it("names any page, so the other tabs need no schema change", () => {
    const { error } = validate({
      claims: { details: { banner } },
      payments: { details: { banner } },
    });

    expect(error).toBeUndefined();
  });

  it("rejects a summary entry with no label to show against it", () => {
    const { error } = validate(
      definition({
        summary: { sbi: { text: "$.identifiers.sbi", type: "string" } },
      }),
    );

    expect(error?.message).toContain("label");
  });

  // Caught when the definition is written rather than when the page renders.
  it("rejects a type it cannot render", () => {
    const { error } = validate(
      definition({ title: { text: "$.clientRef", type: "listOfThings" } }),
    );

    expect(error?.message).toContain("type");
  });

  it("rejects a page with no banner", () => {
    const { error } = validate({ claims: { details: {} } });

    // Joi names it by its label, which is what swagger shows too.
    expect(error?.message).toContain("PageBanner");
  });

  it("rejects a page name that is not one", () => {
    const { error } = validate({ "Claims Page": { details: { banner } } });

    expect(error).toBeDefined();
  });
});
