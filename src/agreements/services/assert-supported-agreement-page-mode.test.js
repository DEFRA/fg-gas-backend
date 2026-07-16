import { describe, expect, it } from "vitest";
import { assertSupportedAgreementPageMode } from "./assert-supported-agreement-page-mode.js";

describe("assertSupportedAgreementPageMode", () => {
  it("allows a supported mode", () => {
    expect(() => assertSupportedAgreementPageMode("view")).not.toThrow();
  });

  it("rejects an unsupported mode", () => {
    expect(() => assertSupportedAgreementPageMode("document")).toThrow(
      'Unsupported mode "document"',
    );
  });

  it("rejects a missing mode", () => {
    expect(() => assertSupportedAgreementPageMode(undefined)).toThrow(
      'Unsupported mode "undefined"',
    );
  });
});
