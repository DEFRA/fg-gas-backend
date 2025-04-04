import { describe, it, expect, vi, beforeAll } from "vitest";
import hapi from "@hapi/hapi";
import Joi from "joi";
import { grantsPlugin } from "./index.js";
import * as grantService from "./grant-service.js";

vi.mock("./grant-service.js", () => ({
  create: vi.fn(),
  findAll: vi.fn(),
  findByCode: vi.fn(),
  invokeGetAction: vi.fn(),
  invokePostAction: vi.fn(),
}));

let server;

beforeAll(async () => {
  server = hapi.server();
  await server.register(grantsPlugin);
  await server.initialize();
});

describe("POST /grants", () => {
  it("creates a new grant and returns the id", async () => {
    const createGrantRequest = {
      code: "test",
      metadata: {
        description: "test",
        startDate: "2021-01-01T00:00:00.000Z",
      },
      actions: [],
      questions: [],
    };

    grantService.create.mockResolvedValueOnce(createGrantRequest);

    const { statusCode, result } = await server.inject({
      method: "POST",
      url: "/grants",
      payload: createGrantRequest,
    });

    expect(grantService.create).toHaveBeenCalledWith({
      code: "test",
      metadata: {
        description: "test",
        startDate: Joi.date().validate("2021-01-01T00:00:00.000Z").value,
      },
      actions: [],
      questions: [],
    });
    expect(statusCode).toEqual(201);
    expect(result).toEqual({
      code: "test",
    });
  });
});

describe("GET /grants", () => {
  it("returns all grants", async () => {
    grantService.findAll.mockResolvedValueOnce([
      {
        code: "1",
        metadata: {
          description: "test 1",
          startDate: "2021-01-01T00:00:00.000Z",
        },
        actions: [],
        questions: [],
        internal: "this is private",
      },
      {
        code: "2",
        metadata: {
          description: "test 2",
          startDate: "2021-01-01T00:00:00.000Z",
        },
        actions: [],
        questions: [],
        internal: "this is private",
      },
    ]);

    const { statusCode, result } = await server.inject({
      method: "GET",
      url: "/grants",
    });

    expect(statusCode).toEqual(200);

    expect(result).toEqual([
      {
        code: "1",
        metadata: {
          description: "test 1",
          startDate: "2021-01-01T00:00:00.000Z",
        },
        actions: [],
        questions: [],
      },
      {
        code: "2",
        metadata: {
          description: "test 2",
          startDate: "2021-01-01T00:00:00.000Z",
        },
        actions: [],
        questions: [],
      },
    ]);
  });
});

describe("GET /grants/{code}", () => {
  it("returns matching grant", async () => {
    grantService.findByCode.mockResolvedValueOnce({
      code: "adding-value",
      metadata: {
        description: "test 1",
        startDate: "2021-01-01T00:00:00.000Z",
      },
      actions: [],
      questions: [],
      internal: "this is private",
    });

    const { statusCode, result } = await server.inject({
      method: "GET",
      url: "/grants/adding-value",
    });

    expect(statusCode).toEqual(200);

    expect(result).toEqual({
      code: "adding-value",
      metadata: {
        description: "test 1",
        startDate: "2021-01-01T00:00:00.000Z",
      },
      actions: [],
      questions: [],
    });
  });
});

describe("GET /grants/{code}/actions/{name}/invoke", () => {
  it("returns response from action", async () => {
    grantService.invokeGetAction.mockResolvedValueOnce({
      arbitrary: "result",
    });

    const { statusCode, result } = await server.inject({
      method: "GET",
      url: "/grants/adding-value/actions/test/invoke",
    });

    expect(statusCode).toEqual(200);

    expect(result).toEqual({
      arbitrary: "result",
    });

    expect(grantService.invokeGetAction).toHaveBeenCalledWith({
      code: "adding-value",
      name: "test",
    });
  });
});

describe("POST /grants/{code}/actions/{name}/invoke", () => {
  it("returns response from action", async () => {
    grantService.invokePostAction.mockResolvedValueOnce({
      arbitrary: "result",
    });

    const { statusCode, result } = await server.inject({
      method: "POST",
      url: "/grants/adding-value/actions/test/invoke",
      payload: {
        code: "adding-value",
        name: "test",
      },
    });

    expect(statusCode).toEqual(200);

    expect(result).toEqual({
      arbitrary: "result",
    });

    expect(grantService.invokePostAction).toHaveBeenCalledWith({
      code: "adding-value",
      name: "test",
      payload: {
        code: "adding-value",
        name: "test",
      },
    });
  });
});
