import { setTimeout } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import {
  getRequestContext,
  withRequestContext,
} from "./get-request-context.js";

describe("getRequestContext", () => {
  it("returns request context", async () => {
    const mockContext = {
      id: "1234-5678",
    };
    const requestContext = await withRequestContext(mockContext, async () => {
      await setTimeout();
      return getRequestContext();
    });
    expect(requestContext).toBe(mockContext);
  });

  it("returns null when called outside a withRequestContext scope", () => {
    expect(getRequestContext()).toBeNull();
  });
});
