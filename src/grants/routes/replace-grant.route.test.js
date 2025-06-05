import hapi from "@hapi/hapi";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { replaceGrantRequestSchema } from "../schemas/requests/replace-grant-request.schema.js";
import { replaceGrantUseCase } from "../use-cases/replace-grant.use-case.js";
import { replaceGrantRoute } from "./replace-grant.route.js";

vi.mock("../use-cases/replace-grant.use-case.js");

describe("replaceGrantRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.route(replaceGrantRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  it("replaces an existing grant and returns no content", async () => {
    const { statusCode, result } = await server.inject({
      method: "PUT",
      url: "/tmp/grants/test-grant",
      payload: {
        code: "test-grant",
        metadata: {
          description: "Updated test grant",
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

    expect(replaceGrantUseCase).toHaveBeenCalledWith("test-grant", {
      metadata: {
        description: "Updated test grant",
        startDate: new Date("2100-01-01T00:00:00.000Z"),
      },
      actions: [],
      questions: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
      },
    });
  });

  it("validates payload using replaceGrantRequestSchema", async () => {
    expect(replaceGrantRoute.options.validate.payload).toBe(
      replaceGrantRequestSchema,
    );
  });

  it("returns 400 when payload is invalid", async () => {
    const { statusCode, result } = await server.inject({
      method: "PUT",
      url: "/tmp/grants/test-grant",
      payload: {
        code: "test-grant",
        metadata: {
          description: "Updated test grant",
          startDate: "invalid-date", // Invalid date format
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
