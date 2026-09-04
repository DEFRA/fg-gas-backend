import { describe, expect, it, vi } from "vitest";
import { breakdownEventsUseCase } from "../use-cases/breakdown-events.use-case.js";
import { breakdownEventsRoute } from "./breakdown-events.route.js";

vi.mock("../../common/logger.js");
vi.mock("../use-cases/breakdown-events.use-case.js");

const handle = (query) => breakdownEventsRoute.handler({ query });

describe("breakdownEventsRoute", () => {
  it("is a GET one segment after /events, so it cannot collide with the detail route", () => {
    expect(breakdownEventsRoute.method).toBe("GET");
    expect(breakdownEventsRoute.path).toBe("/grant-admin/events/breakdown");
  });

  it("has no auth option, so the default service strategy applies", () => {
    expect(breakdownEventsRoute.options.auth).toBeUndefined();
  });

  it("passes the selection filter straight through", async () => {
    breakdownEventsUseCase.mockResolvedValue({ groups: [], sourceErrors: [] });

    await handle({
      service: "gas",
      q: "GLD-9B2",
      from: "2026-06-16T00:00:00.000Z",
      to: "2026-06-16T23:59:59.999Z",
    });

    expect(breakdownEventsUseCase).toHaveBeenCalledWith({
      service: "gas",
      q: "GLD-9B2",
      from: "2026-06-16T00:00:00.000Z",
      to: "2026-06-16T23:59:59.999Z",
    });
  });

  it("returns the use case's answer as the response body", async () => {
    const result = { groups: [], sourceErrors: [] };
    breakdownEventsUseCase.mockResolvedValue(result);

    expect(await handle({})).toBe(result);
  });

  it("rejects a status - the breakdown is always over DEAD_LETTER rows", () => {
    expect(
      breakdownEventsRoute.options.validate.query.validate({
        status: "FAILED",
      }).error,
    ).toBeDefined();
  });

  it("rejects an error filter - the breakdown already answers that question", () => {
    expect(
      breakdownEventsRoute.options.validate.query.validate({ error: "boom" })
        .error,
    ).toBeDefined();
  });

  it("validates its response, so a mapping gap fails a test", () => {
    expect(breakdownEventsRoute.options.response.schema).toBeDefined();
  });
});
