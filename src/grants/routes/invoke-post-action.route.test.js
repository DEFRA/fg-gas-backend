import hapi from "@hapi/hapi";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { invokePostActionUseCase } from "../use-cases/invoke-post-action.use-case.js";
import { invokePostActionRoute } from "./invoke-post-action.route.js";

vi.mock("../use-cases/invoke-post-action.use-case.js");

describe("invokePostActionRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.route(invokePostActionRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  it("invokes a POST action for a grant and returns response", async () => {
    invokePostActionUseCase.mockResolvedValue({
      some: "response",
    });

    const { statusCode, result } = await server.inject({
      method: "POST",
      url: "/grants/test-grant/actions/action1/invoke",
      payload: {
        data: "value",
      },
    });

    expect(statusCode).toEqual(200);

    expect(result).toEqual({
      some: "response",
    });

    expect(invokePostActionUseCase).toHaveBeenCalledWith({
      code: "test-grant",
      name: "action1",
      payload: {
        data: "value",
      },
    });
  });

  it("validates payload using invokePostActionRequestSchema", async () => {
    expect(invokePostActionRoute.options.validate.payload).toBe(
      invokePostActionRoute.options.validate.payload,
    );
  });

  it("returns 400 when payload is not an object", async () => {
    const { statusCode, result } = await server.inject({
      method: "POST",
      url: "/grants/test-grant/actions/action1/invoke",
      payload: "true", // Invalid payload
    });

    expect(statusCode).toEqual(400);
    expect(result).toEqual({
      statusCode: 400,
      error: "Bad Request",
      message: "Invalid request payload input",
    });
  });
});
