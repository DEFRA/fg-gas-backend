import hapi from "@hapi/hapi";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { invokeActionUseCase } from "../use-cases/invoke-action.use-case.js";
import {
  invokeGetActionRoute,
  invokePostActionRoute,
} from "./invoke-action.route.js";

vi.mock("../use-cases/invoke-action.use-case.js");

let server;

beforeAll(async () => {
  server = hapi.server();
  server.route([invokeGetActionRoute, invokePostActionRoute]);
  await server.initialize();
});

afterAll(async () => {
  await server.stop();
});

describe("invokeGetActionRoute", () => {
  it("invokes a GET action", async () => {
    invokeActionUseCase.mockResolvedValue({
      some: "response",
    });

    const { statusCode, result } = await server.inject({
      method: "GET",
      url: "/grants/test-grant/actions/action1/invoke?paramOne=valueOne",
    });

    expect(statusCode).toEqual(200);
    expect(result).toEqual({
      some: "response",
    });

    expect(invokeActionUseCase).toHaveBeenCalledWith({
      code: "test-grant",
      name: "action1",
      method: "GET",
      params: { paramOne: "valueOne" },
    });
  });

  it("invokes a GET action with invalid code", async () => {
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

describe("invokePostActionRoute", () => {
  it("invokes a POST action for a grant and returns response", async () => {
    invokeActionUseCase.mockResolvedValue({
      some: "response",
    });

    const { statusCode, result } = await server.inject({
      method: "POST",
      url: "/grants/test-grant/actions/action1/invoke?paramOne=valueOne",
      payload: {
        data: "value",
      },
    });

    expect(statusCode).toEqual(200);
    expect(result).toEqual({
      some: "response",
    });

    expect(invokeActionUseCase).toHaveBeenCalledWith({
      code: "test-grant",
      name: "action1",
      method: "POST",
      payload: {
        data: "value",
      },
      params: { paramOne: "valueOne" },
    });
  });

  it("invokes a POST action with no playload", async () => {
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
