import { describe, expect, it } from "vitest";
import { getRequestContext, withRequestContext } from "./request-context.js";

describe("request-context", () => {
  it("returns null when no context is set", () => {
    expect(getRequestContext()).toBeNull();
  });

  it("returns the context within the run callback", async () => {
    const context = {
      user: "user-123",
      subject: null,
      sessionId: "sess-1",
      ip: "1.2.3.4",
    };
    let captured;

    await withRequestContext(context, async () => {
      captured = getRequestContext();
    });

    expect(captured).toEqual(context);
  });

  it("returns null after the run callback completes", async () => {
    await withRequestContext({ user: "user-123" }, async () => {});
    expect(getRequestContext()).toBeNull();
  });

  it("propagates context through async operations", async () => {
    const context = {
      user: "user-456",
      subject: "farmer-789",
      sessionId: "sess-2",
      ip: "5.6.7.8",
    };
    let captured;

    await withRequestContext(context, async () => {
      await Promise.resolve();
      captured = getRequestContext();
    });

    expect(captured).toEqual(context);
  });
});
