import { describe, expect, it } from "vitest";
import { searchAuditOf } from "./audit.js";
import { valueDigest } from "./digest.js";

const KEY = "an-invented-audit-key-of-32-chars!";

describe("searchAuditOf", () => {
  it("holds a field search's key and match, and its value only as a digest", () => {
    const query = {
      ref: null,
      field: { key: "businessName", match: "prefix", value: "hilltop" },
    };

    expect(searchAuditOf(query, KEY)).toEqual({
      field: "businessName",
      match: "prefix",
      valueDigest: valueDigest(KEY, "businessName:hilltop"),
    });
    expect(JSON.stringify(searchAuditOf(query, KEY))).not.toContain("hilltop");
  });

  it("digests a ref searched for", () => {
    expect(searchAuditOf({ ref: "sbi:123", field: null }, KEY)).toEqual({
      field: null,
      match: null,
      valueDigest: valueDigest(KEY, "sbi:123"),
    });
  });

  it("holds no digest without a key, or with nothing searched for", () => {
    const query = {
      ref: null,
      field: { key: "businessName", match: "exact", value: "hilltop" },
    };

    expect(searchAuditOf(query, null)).toEqual({
      field: "businessName",
      match: "exact",
    });
    expect(searchAuditOf({ ref: null, field: null }, KEY)).toEqual({
      field: null,
      match: null,
    });
  });
});
