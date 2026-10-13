import { describe, expect, it } from "vitest";
import { caseRefsOf, toCaseLink } from "./case-refs.js";

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
