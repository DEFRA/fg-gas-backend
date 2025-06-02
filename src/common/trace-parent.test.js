import { setTimeout } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { getTraceParent, withTraceParent } from "./trace-parent.js";

describe("traceParent", () => {
  it("runs a function with traceParent in async scope", async () => {
    const traceParent = await withTraceParent("1234-0987", async () => {
      await setTimeout(1);
      return getTraceParent();
    });

    expect(traceParent).toEqual("1234-0987");
  });
});
