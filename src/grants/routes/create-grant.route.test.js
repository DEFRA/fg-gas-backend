import hapi from "@hapi/hapi";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createGrantRequestSchema } from "../schemas/requests/create-grant-request.schema.js";
import { createGrantUseCase } from "../use-cases/create-grant.use-case.js";
import { createGrantRoute } from "./create-grant.route.js";

vi.mock("../use-cases/create-grant.use-case.js");

describe("createGrantRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.route(createGrantRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  it("creates a new grant and returns no content", async () => {
    const { statusCode, result } = await server.inject({
      method: "POST",
      url: "/grants",
      payload: {
        code: "test",
        metadata: {
          description: "test",
          startDate: "2100-01-01T00:00:00.000Z",
        },
        actions: [],
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
        },
      },
    });

    expect(statusCode).toEqual(204);

    expect(result).toEqual(null);

    expect(createGrantUseCase).toHaveBeenCalledWith({
      code: "test",
      metadata: {
        description: "test",
        startDate: new Date("2100-01-01T00:00:00.000Z"),
      },
      actions: [],
      questions: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
      },
    });
  });

  it("validates payload using createGrantRequestSchema", async () => {
    expect(createGrantRoute.options.validate.payload).toBe(
      createGrantRequestSchema,
    );
  });

  it("returns 400 when payload is invalid", async () => {
    const { statusCode, result } = await server.inject({
      method: "POST",
      url: "/grants",
      payload: {
        code: "test",
        metadata: {
          description: "test",
          startDate: "invalid-date",
        },
        actions: [],
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
        },
      },
    });

    expect(statusCode).toEqual(400);
    expect(result).toEqual({
      statusCode: 400,
      error: "Bad Request",
      message: "Invalid request payload input",
    });
  });
});
