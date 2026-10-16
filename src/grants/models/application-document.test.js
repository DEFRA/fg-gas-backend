import { describe, expect, it } from "vitest";
import {
  ApplicationDocument,
  applicationRefs,
  seriesRefs,
} from "./application-document.js";

describe("applicationRefs", () => {
  it("refs the client reference, every identifier and each agreement number", () => {
    expect(
      applicationRefs({
        clientRef: "ABC-123",
        identifiers: { sbi: "900000001", frn: "1000000001", crn: "9000000005" },
        agreements: { FPTT000000001: {}, FPTT000000002: {} },
      }),
    ).toEqual([
      "ref:abc-123",
      "sbi:900000001",
      "frn:1000000001",
      "crn:9000000005",
      "agreement:fptt000000001",
      "agreement:fptt000000002",
    ]);
  });

  it("refs only what the application holds", () => {
    expect(applicationRefs({ clientRef: "abc-123" })).toEqual(["ref:abc-123"]);
    expect(
      applicationRefs({
        clientRef: "abc-123",
        identifiers: { sbi: null, frn: "" },
        agreements: null,
      }),
    ).toEqual(["ref:abc-123"]);
  });
});

describe("seriesRefs", () => {
  it("refs every member of a series once", () => {
    expect(seriesRefs(["ABC-123", "abc-124", "abc-123"])).toEqual([
      "ref:abc-123",
      "ref:abc-124",
    ]);
  });
});

describe("ApplicationDocument", () => {
  it("carries the application's refs", () => {
    const document = new ApplicationDocument({
      clientRef: "abc-123",
      code: "example-grant",
      identifiers: { sbi: "900000001" },
      agreements: {},
    });

    expect(document.refs).toEqual(["ref:abc-123", "sbi:900000001"]);
  });

  it("holds no replaced flag, so no save can carry a stale one back", () => {
    const document = new ApplicationDocument({
      clientRef: "abc-123",
      code: "example-grant",
      replaced: true,
    });

    expect(document).not.toHaveProperty("replaced");
  });
});
