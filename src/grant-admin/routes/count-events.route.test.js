import { describe, expect, it, vi } from "vitest";
import { countEventsUseCase } from "../use-cases/count-events.use-case.js";
import { countEventsRoute } from "./count-events.route.js";

vi.mock("../../common/logger.js");
vi.mock("../use-cases/count-events.use-case.js");

const validateQuery = (query) =>
  countEventsRoute.options.validate.query.validate(query);

describe("countEventsRoute", () => {
  it("is a GET on /grant-admin/events/counts", () => {
    expect(countEventsRoute.method).toBe("GET");
    expect(countEventsRoute.path).toBe("/grant-admin/events/counts");
  });

  it("is one segment after /events, so it cannot collide with the detail route", () => {
    expect(countEventsRoute.path.split("/")).toHaveLength(4);
    expect(countEventsRoute.path).not.toContain("{");
  });

  it("leaves auth to the default service strategy", () => {
    expect(countEventsRoute.options.auth).toBeUndefined();
  });

  it("declares the counts response schema", () => {
    expect(
      countEventsRoute.options.response.schema.describe().flags.label,
    ).toBe("CountEventsResponse");
  });

  it("accepts an empty query and rejects a status", () => {
    expect(validateQuery({}).error).toBeUndefined();
    expect(validateQuery({ status: "FAILED" }).error).toBeDefined();
  });

  it("rejects a cursor and an unknown parameter", () => {
    expect(validateQuery({ cursor: "abc" }).error).toBeDefined();
    expect(validateQuery({ pageSize: 20 }).error).toBeDefined();
  });

  it("passes the validated query to the use case", async () => {
    const answer = {
      counts: {},
      sourceErrors: [],
    };
    countEventsUseCase.mockResolvedValue(answer);

    const result = await countEventsRoute.handler({
      query: {
        service: "gas",
        q: "GLD-9B2",
        error: "boom",
        from: "2026-06-16T00:00:00.000Z",
        to: "2026-06-16T23:59:59.999Z",
      },
    });

    expect(countEventsUseCase).toHaveBeenCalledWith({
      service: "gas",
      q: "GLD-9B2",
      error: "boom",
      from: "2026-06-16T00:00:00.000Z",
      to: "2026-06-16T23:59:59.999Z",
    });
    expect(result).toBe(answer);
  });
});
