import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { valueDigest } from "./digest.js";

describe("valueDigest", () => {
  it("is the HMAC-SHA256 of the text under the key", () => {
    expect(valueDigest("secret", "businessName:hilltopfarm")).toBe(
      createHmac("sha256", "secret")
        .update("businessName:hilltopfarm")
        .digest("hex"),
    );
  });

  it("differs by key", () => {
    expect(valueDigest("one", "ref:abc")).not.toBe(
      valueDigest("two", "ref:abc"),
    );
  });
});
