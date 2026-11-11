import { describe, expect, it } from "vitest";
import {
  MAX_VALUES_PER_FIELD,
  addLeftOut,
  describeLeftOut,
  keysOf,
} from "./keys.js";

const businessName = {
  key: "businessName",
  label: "Business name",
  path: "$.answers.business.name",
  match: "prefix",
};

const applicantName = {
  key: "applicantName",
  label: "Applicant name",
  path: ["$.answers.applicant.first", "$.answers.applicant.last"],
  match: "prefix",
};

const parcelId = {
  key: "parcelId",
  label: "Parcel ID",
  path: "$.answers.parcels[*].id",
  match: "exact",
};

const view = (answers) => ({ answers });

describe("keysOf", () => {
  it("writes each declared value as key:normalised, and leaves nothing out", () => {
    expect(
      keysOf(
        view({
          business: { name: "Hilltop Farm Ltd." },
          applicant: { first: "Jo", last: "O’Brien" },
          parcels: [{ id: "SX0679 9238" }, { id: "SX0679-9238" }, { id: 12 }],
        }),
        [businessName, applicantName, parcelId],
      ),
    ).toEqual({
      keys: [
        "businessName:hilltopfarmltd",
        "applicantName:joobrien",
        "parcelId:sx06799238",
        "parcelId:12",
      ],
      left: {},
    });
  });

  it("joins the parts that are present", () => {
    expect(
      keysOf(view({ applicant: { last: "Brown" } }), [applicantName]).keys,
    ).toEqual(["applicantName:brown"]);
  });

  it("writes nothing for a missing, null or empty value", () => {
    expect(
      keysOf(
        view({
          business: { name: null },
          applicant: {},
          parcels: [{ id: " - " }],
        }),
        [businessName, applicantName, parcelId],
      ),
    ).toEqual({ keys: [], left: {} });
  });

  it("counts values that are not strings or numbers, never indexing them", () => {
    expect(
      keysOf(
        view({
          business: { name: { text: "Hilltop" } },
          applicant: { first: "Jo", last: ["Brown"] },
          parcels: [{ id: true }, { id: "SX1" }, { id: [1] }],
        }),
        [businessName, applicantName, parcelId],
      ),
    ).toEqual({
      keys: ["parcelId:sx1"],
      left: {
        businessName: { unsupported: 1, overCap: 0 },
        applicantName: { unsupported: 1, overCap: 0 },
        parcelId: { unsupported: 2, overCap: 0 },
      },
    });
  });

  it("counts values beyond 50 a field and over 200 characters", () => {
    const parcels = Array.from(
      { length: MAX_VALUES_PER_FIELD + 2 },
      (_, n) => ({
        id: `P${n}`,
      }),
    );

    const { keys, left } = keysOf(
      view({ business: { name: "a".repeat(201) }, parcels }),
      [businessName, parcelId],
    );

    expect(keys).toHaveLength(MAX_VALUES_PER_FIELD);
    expect(keys.at(-1)).toBe("parcelId:p49");
    expect(left).toEqual({
      businessName: { unsupported: 0, overCap: 1 },
      parcelId: { unsupported: 0, overCap: 2 },
    });
  });

  it("writes no keys for no fields", () => {
    expect(keysOf(view({ business: { name: "x" } }), [])).toEqual({
      keys: [],
      left: {},
    });
  });
});

describe("addLeftOut and describeLeftOut", () => {
  it("adds counts by key and names them without values", () => {
    const total = addLeftOut(
      addLeftOut({}, { parcelId: { unsupported: 1, overCap: 0 } }),
      {
        parcelId: { unsupported: 2, overCap: 3 },
        businessName: { unsupported: 0, overCap: 1 },
      },
    );

    expect(total).toEqual({
      parcelId: { unsupported: 3, overCap: 3 },
      businessName: { unsupported: 0, overCap: 1 },
    });
    expect(describeLeftOut(total)).toBe(
      "parcelId (3 not text, 3 over the caps), businessName (0 not text, 1 over the caps)",
    );
  });
});
