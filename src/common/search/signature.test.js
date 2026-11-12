import { describe, expect, it } from "vitest";
import { ALGORITHM, sig, stampOf } from "./signature.js";

const field = {
  key: "businessName",
  label: "Business name",
  path: "$.answers.business.name",
  match: "exact",
};

describe("sig", () => {
  it("is a short hex digest, the same for the same fields", () => {
    expect(sig([field])).toMatch(/^[0-9a-f]{12}$/);
    expect(sig([{ ...field }])).toBe(sig([field]));
  });

  it("changes with a field's key, path or match, or their order", () => {
    const other = { ...field, key: "postcode" };

    expect(sig([{ ...field, key: "name" }])).not.toBe(sig([field]));
    expect(sig([{ ...field, path: "$.answers.name" }])).not.toBe(sig([field]));
    expect(sig([{ ...field, match: "prefix" }])).not.toBe(sig([field]));
    expect(sig([field, other])).not.toBe(sig([other, field]));
  });

  it("does not change with a label", () => {
    expect(sig([{ ...field, label: "Name" }])).toBe(sig([field]));
  });

  it("differs between no fields and some", () => {
    expect(sig([])).not.toBe(sig([field]));
  });
});

describe("stampOf", () => {
  it("orders the declarations of one lead value by their count of config changes", () => {
    expect(stampOf(0) < stampOf(1)).toBe(true);
    expect(stampOf(9) < stampOf(10)).toBe(true);
    expect(stampOf(99_999) < stampOf(100_000)).toBe(true);
  });

  it("leads with the algorithm, so a later one outranks any count", () => {
    expect(stampOf(42)).toBe(
      `${String(ALGORITHM).padStart(4, "0")}:${"42".padStart(12, "0")}`,
    );
    expect(stampOf(42) > "0002:2026-10-01T09:00:00.000Z").toBe(true);
  });
});
