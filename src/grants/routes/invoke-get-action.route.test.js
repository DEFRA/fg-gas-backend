import hapi from "@hapi/hapi";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { invokeGetActionUseCase } from "../use-cases/invoke-get-action.use-case.js";
import { invokeGetActionRoute } from "./invoke-get-action.route.js";

vi.mock("../use-cases/invoke-get-action.use-case.js");

describe("findGrantByCodeRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.route(invokeGetActionRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  it("invokes a named GET action for a grant and returns response", async () => {
    invokeGetActionUseCase.mockResolvedValue({
      some: "response",
    });

    const { statusCode, result } = await server.inject({
      method: "GET",
      url: "/grants/test-grant/actions/action1/invoke",
    });

    expect(statusCode).toEqual(200);
    expect(result).toEqual({
      some: "response",
    });

    expect(invokeGetActionUseCase).toHaveBeenCalledWith({
      code: "test-grant",
      name: "action1",
    });
  });

  it("returns 400 when code is invalid", async () => {
    const { statusCode, result } = await server.inject({
      method: "GET",
      url: "/grants/invalid_grant/actions/invalid-action/invoke",
    });

    expect(statusCode).toEqual(400);

    expect(result).toEqual({
      statusCode: 400,
      error: "Bad Request",
      message: "Invalid request params input",
    });
  });
});
