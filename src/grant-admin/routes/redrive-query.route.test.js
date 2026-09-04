import { describe, expect, it, vi } from "vitest";
import { redriveQueryUseCase } from "../use-cases/redrive-query.use-case.js";
import { redriveQueryRoute } from "./redrive-query.route.js";

vi.mock("../use-cases/redrive-query.use-case.js");

const handle = (request) =>
  redriveQueryRoute.handler({
    query: {},
    payload: null,
    headers: {},
    auth: { credentials: { service: "admin-ui" } },
    ...request,
  });

describe("redriveQueryRoute", () => {
  it("is a POST one segment after /events", () => {
    expect(redriveQueryRoute.method).toBe("POST");
    expect(redriveQueryRoute.path).toBe("/grant-admin/events/redrive-query");
  });

  it("takes the filter from the query string", async () => {
    redriveQueryUseCase.mockResolvedValue({});

    await handle({ query: { q: "GLD-9B2", limit: 10 } });

    expect(redriveQueryUseCase).toHaveBeenCalledWith(
      expect.objectContaining({ q: "GLD-9B2", limit: 10 }),
    );
  });

  it("takes the filter from a JSON body too", async () => {
    redriveQueryUseCase.mockResolvedValue({});

    await handle({ payload: { error: "boom", limit: 20 } });

    expect(redriveQueryUseCase).toHaveBeenCalledWith(
      expect.objectContaining({ error: "boom", limit: 20 }),
    );
  });

  it("lets the body win over the query string when both are given", async () => {
    redriveQueryUseCase.mockResolvedValue({});

    await handle({ query: { q: "from-query" }, payload: { q: "from-body" } });

    expect(redriveQueryUseCase).toHaveBeenCalledWith(
      expect.objectContaining({ q: "from-body" }),
    );
  });

  it("records the authenticated caller and the x-actor operator", async () => {
    redriveQueryUseCase.mockResolvedValue({});

    await handle({ headers: { "x-actor": "donatas" } });

    expect(redriveQueryUseCase).toHaveBeenCalledWith(
      expect.objectContaining({ caller: "admin-ui", actor: "donatas" }),
    );
  });

  it("passes a null actor when nobody named themselves", async () => {
    redriveQueryUseCase.mockResolvedValue({});

    await handle({});

    expect(redriveQueryUseCase).toHaveBeenCalledWith(
      expect.objectContaining({ actor: null }),
    );
  });

  it("defaults the limit to 500 and caps it there", () => {
    const { query } = redriveQueryRoute.options.validate;

    expect(query.validate({}).value.limit).toBe(500);
    expect(query.validate({ limit: 501 }).error).toBeDefined();
    expect(query.validate({ limit: 0 }).error).toBeDefined();
  });

  it("rejects a status - the scope is implicitly DEAD_LETTER", () => {
    expect(
      redriveQueryRoute.options.validate.query.validate({
        status: "PUBLISHED",
      }).error,
    ).toBeDefined();
  });

  it("validates the actor header", () => {
    expect(redriveQueryRoute.options.validate.headers).toBeDefined();
  });
});
