import { describe, expect, it } from "vitest";
import {
  applicationRefsOf,
  caseRefsOf,
  toApplicationLink,
  toCaseLink,
} from "./case-refs.js";

describe("applicationRefsOf", () => {
  it("pairs the reference with the reference within its grant", () => {
    expect(applicationRefsOf(" example-grant", "abc-123 ")).toEqual([
      ["ref", "abc-123 "],
      ["application", "example-grant:abc-123"],
    ]);
  });

  it.each([
    [null, "abc-123"],
    ["example-grant", undefined],
    ["example-grant", " "],
  ])(
    "leaves out the grant link when a part is missing (%j, %j)",
    (code, clientRef) => {
      expect(applicationRefsOf(code, clientRef)[1]).toEqual([
        "application",
        null,
      ]);
    },
  );
});

describe("toApplicationLink", () => {
  it("reads as the grant and the reference when both are plain", () => {
    expect(toApplicationLink("woodland", "client-wmp-test-0061")).toBe(
      "application:woodland:client-wmp-test-0061",
    );
  });

  it("is the link a writer stamps", () => {
    const [, [kind, value]] = applicationRefsOf("Example-Grant", "ABC_123");

    expect(toApplicationLink("Example-Grant", "ABC_123")).toBe(
      `${kind}:${value}`,
    );
  });

  it("keeps the same reference in two grants apart", () => {
    expect(
      toApplicationLink("frps-private-beta", "client-wmp-test-0061"),
    ).not.toBe(toApplicationLink("woodland", "client-wmp-test-0061"));
  });

  it("keeps grants and references that differ only in case, or by a colon, apart", () => {
    const links = [
      toApplicationLink("alpha", "abc"),
      toApplicationLink("Alpha", "abc"),
      toApplicationLink("alpha", "ABC"),
      toApplicationLink("alpha", "~41.bc"),
      toApplicationLink("alpha:abc", "x"),
      toApplicationLink("alpha", "abc:x"),
    ];

    expect(new Set(links).size).toBe(links.length);
  });

  it("is null when a part is missing", () => {
    expect(toApplicationLink("woodland", null)).toBeNull();
  });
});

describe("caseRefsOf", () => {
  it("pairs the reference with the reference within its workflow", () => {
    expect(caseRefsOf(" example-workflow", "abc-123 ")).toEqual([
      ["ref", "abc-123 "],
      ["case", "example-workflow:abc-123"],
    ]);
  });

  it.each([
    [null, "abc-123"],
    ["example-workflow", undefined],
    ["example-workflow", " "],
  ])(
    "leaves out the workflow link when a part is missing (%j, %j)",
    (workflowCode, caseRef) => {
      expect(caseRefsOf(workflowCode, caseRef)[1]).toEqual(["case", null]);
    },
  );
});

describe("toCaseLink", () => {
  it("reads as the workflow and the reference when both are plain", () => {
    expect(toCaseLink("example-workflow", "abc-123")).toBe(
      "case:example-workflow:abc-123",
    );
  });

  it("is the link a writer stamps", () => {
    const [, [kind, value]] = caseRefsOf("Example-Workflow", "ABC_123");

    expect(toCaseLink("Example-Workflow", "ABC_123")).toBe(`${kind}:${value}`);
  });

  it("keeps workflows and references that differ only in case apart", () => {
    const links = [
      toCaseLink("alpha", "abc"),
      toCaseLink("Alpha", "abc"),
      toCaseLink("alpha", "ABC"),
      toCaseLink("alpha", "~41.bc"),
    ];

    expect(new Set(links).size).toBe(links.length);
  });

  it("is null when a part is missing", () => {
    expect(toCaseLink("example-workflow", null)).toBeNull();
  });
});
