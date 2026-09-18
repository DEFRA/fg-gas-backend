import { describe, expect, it } from "vitest";
import { isRetryableFailure, markPermanentFailure } from "./retryable.js";

describe("retryable", () => {
  it("treats an error that says nothing as retryable", () => {
    expect(isRetryableFailure(new Error("boom"))).toBe(true);
  });

  it("treats a missing error as retryable", () => {
    expect(isRetryableFailure(undefined)).toBe(true);
  });

  it("treats a marked error as not retryable", () => {
    expect(isRetryableFailure(markPermanentFailure(new Error("boom")))).toBe(
      false,
    );
  });

  it("returns the error it marks, so it can be thrown straight on", () => {
    const error = new Error("boom");

    expect(markPermanentFailure(error)).toBe(error);
    expect(error.message).toBe("boom");
  });
});
