import { vi, describe, test, expect } from "vitest";
import { AsyncLocalStorage } from "node:async_hooks";
import { wrapTraceParent, getTraceParent } from "./eventTraceParent";
import { getTraceId } from "@defra/hapi-tracing";

vi.mock("@defra/hapi-tracing", () => ({
  getTraceId: vi.fn(),
}));

describe("eventTraceParent", () => {
  test("should method with wrapTraceParent", () => {
    vi.spyOn(AsyncLocalStorage.prototype, "run");
    const mock = vi.fn();
    wrapTraceParent(mock, "1234-0987");
    expect(AsyncLocalStorage.prototype.run).toHaveBeenCalledWith(
      expect.any(Map),
      mock,
    );
    expect(
      AsyncLocalStorage.prototype.run.mock.calls[0][0].get("traceParent"),
    ).toBe("1234-0987");
  });

  test("should return traceparent if set", () => {
    const mockTraceParentId = "0987-1234";
    const mockGet = vi.fn().mockReturnValue(mockTraceParentId);
    vi.spyOn(AsyncLocalStorage.prototype, "getStore").mockReturnValue({
      get: mockGet,
    });

    expect(getTraceParent()).toEqual(mockTraceParentId);
  });

  test("should return traceId if no traceparent is set", () => {
    const mockTraceId = "ABCD-1234";
    vi.spyOn(AsyncLocalStorage.prototype, "getStore").mockReturnValue(null);
    getTraceId.mockReturnValue(mockTraceId);
    expect(getTraceParent()).toEqual(mockTraceId);
  });
});
