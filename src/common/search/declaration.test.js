import { describe, expect, it } from "vitest";
import { fieldsOf, searchDeclaration } from "./declaration.js";

const schema = searchDeclaration(["$.answers."]);

const field = (overrides = {}) => ({
  key: "businessName",
  label: "Business name",
  path: "$.answers.applicant.business.name",
  ...overrides,
});

const check = (fields) => schema.validate({ fields });

describe("searchDeclaration", () => {
  it("accepts a declaration and defaults a field's match to exact", () => {
    const { error, value } = check([
      field({ match: "prefix" }),
      field({
        key: "applicantName",
        label: "Applicant name",
        path: [
          "$.answers.applicant.customer.name.first",
          "$.answers.applicant.customer.name.last",
        ],
      }),
      field({
        key: "landParcelId",
        label: "Land parcel ID",
        path: "$.answers.landParcels[*].parcelId",
      }),
    ]);

    expect(error).toBeUndefined();
    expect(value.fields.map(({ match }) => match)).toEqual([
      "prefix",
      "exact",
      "exact",
    ]);
  });

  it("accepts ten fields and refuses eleven", () => {
    const fields = (count) =>
      Array.from({ length: count }, (_, n) => field({ key: `field${n}` }));

    expect(check(fields(10)).error).toBeUndefined();
    expect(check(fields(11)).error).toBeDefined();
  });

  it.each([
    ["no fields", []],
    ["a key used twice", [field(), field({ label: "Again" })]],
    ["a key with an upper-case start", [field({ key: "BusinessName" })]],
    ["a key with punctuation", [field({ key: "business-name" })]],
    ["a key over 40 characters", [field({ key: `a${"b".repeat(40)}` })]],
    ["a reserved key", [field({ key: "sbi" })]],
    ["the reserved key agreement", [field({ key: "agreement" })]],
    ["an empty label", [field({ label: "" })]],
    ["a label over 60 characters", [field({ label: "x".repeat(61) })]],
    ["a path outside the roots", [field({ path: "$.payload.name" })]],
    ["the bare root", [field({ path: "$.answers" })]],
    ["a malformed path", [field({ path: "$.answers.name[0]" })]],
    [
      "a path over 10 segments",
      [field({ path: `$.answers${".a".repeat(10)}` })],
    ],
    [
      "a path over 200 characters",
      [field({ path: `$.answers.${"a".repeat(200)}` })],
    ],
    ["a joined path of one part", [field({ path: ["$.answers.a"] })]],
    [
      "a joined path of five parts",
      [field({ path: Array(5).fill("$.answers.a") })],
    ],
    [
      "a joined part that gives many values",
      [field({ path: ["$.answers.a[*].b", "$.answers.c"] })],
    ],
    ["an unknown match", [field({ match: "contains" })]],
    ["an unknown key in a field", [field({ index: true })]],
  ])("refuses %s", (_, fields) => {
    expect(check(fields).error).toBeDefined();
  });

  it("allows the roots it is given", () => {
    const cw = searchDeclaration(["$.payload.", "$.supplementaryData."]);

    expect(
      cw.validate({
        fields: [field({ path: "$.supplementaryData.agreements[*].ref" })],
      }).error,
    ).toBeUndefined();
    expect(cw.validate({ fields: [field()] }).error).toBeDefined();
  });
});

describe("fieldsOf", () => {
  it("answers no fields for no declaration", () => {
    expect(fieldsOf(undefined)).toEqual([]);
    expect(fieldsOf(null)).toEqual([]);
  });

  it("keeps what a field is searched by and defaults its match", () => {
    expect(fieldsOf({ fields: [{ ...field(), extra: 1 }] })).toEqual([
      { ...field(), match: "exact" },
    ]);
  });
});
