import hapi from "@hapi/hapi";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Grant } from "../models/grant.js";
import { findGrantByCodeUseCase } from "../use-cases/find-grant-by-code.use-case.js";
import { findGrantByCodeRoute } from "./find-grant-by-code.route.js";

vi.mock("../use-cases/find-grant-by-code.use-case.js");

describe("findGrantByCodeRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.route(findGrantByCodeRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  it("finds a grant by code", async () => {
    findGrantByCodeUseCase.mockResolvedValue(
      new Grant({
        code: "test-code",
        metadata: {
          description: "Test Grant",
          startDate: "2100-01-01T00:00:00.000Z",
        },
        actions: [],
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
        },
      }),
    );

    const { statusCode, result } = await server.inject({
      method: "GET",
      url: "/grants/test-code",
    });

    expect(statusCode).toEqual(200);

    expect(result).toEqual({
      code: "test-code",
      metadata: {
        description: "Test Grant",
        startDate: "2100-01-01T00:00:00.000Z",
      },
      actions: [],
      questions: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
      },
    });
  });

  it("validates grant code using code schema", async () => {
    findGrantByCodeUseCase.mockResolvedValue(
      new Grant({
        code: "test-code",
        metadata: {
          description: "Test Grant",
          startDate: "2100-01-01T00:00:00.000Z",
        },
        actions: [],
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
        },
      }),
    );

    const { statusCode, result } = await server.inject({
      method: "GET",
      url: "/grants/not_valid",
    });

    expect(statusCode).toEqual(400);

    expect(result).toEqual({
      error: "Bad Request",
      message: "Invalid request params input",
      statusCode: 400,
    });
  });
});
