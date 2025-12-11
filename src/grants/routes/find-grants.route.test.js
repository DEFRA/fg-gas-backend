import hapi from "@hapi/hapi";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Grant } from "../models/grant.js";
import { findGrantsUseCase } from "../use-cases/find-grants.use-case.js";
import { findGrantsRoute } from "./find-grants.route.js";

vi.mock("../use-cases/find-grants.use-case.js");

describe("findGrantsRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.route(findGrantsRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  it("returns an array of grants", async () => {
    findGrantsUseCase.mockResolvedValue([
      new Grant({
        code: "test-grant",
        metadata: {
          description: "Test Grant Description",
          startDate: "2023-01-01T00:00:00Z",
        },
        actions: [],
        phases: [
          {
            code: "PRE_AWARD",
            stages: [
              {
                code: "ASSESSMENT",
                statuses: [{ code: "RECEIVED", validFrom: [] }],
              },
            ],
            questions: {
              $schema: "https://json-schema.org/draft/2020-12/schema",
              type: "object",
            },
          },
        ],
      }),
      new Grant({
        code: "test-grant",
        metadata: {
          description: "Test Grant Description",
          startDate: "2023-01-01T00:00:00Z",
        },
        actions: [],
        phases: [
          {
            code: "PRE_AWARD",
            stages: [
              {
                code: "ASSESSMENT",
                statuses: [{ code: "RECEIVED", validFrom: [] }],
              },
            ],
            questions: {
              $schema: "https://json-schema.org/draft/2020-12/schema",
              type: "object",
            },
          },
        ],
      }),
    ]);

    const { statusCode, result } = await server.inject({
      method: "GET",
      url: "/grants",
    });

    expect(statusCode).toEqual(200);
    expect(result).toEqual([
      {
        code: "test-grant",
        metadata: {
          description: "Test Grant Description",
          startDate: "2023-01-01T00:00:00Z",
        },
        actions: [],
        phases: [
          {
            code: "PRE_AWARD",
            stages: [
              {
                code: "ASSESSMENT",
                statuses: [{ code: "RECEIVED", validFrom: [] }],
              },
            ],
            questions: {
              $schema: "https://json-schema.org/draft/2020-12/schema",
              type: "object",
            },
          },
        ],
      },
      {
        code: "test-grant",
        metadata: {
          description: "Test Grant Description",
          startDate: "2023-01-01T00:00:00Z",
        },
        actions: [],
        phases: [
          {
            code: "PRE_AWARD",
            stages: [
              {
                code: "ASSESSMENT",
                statuses: [{ code: "RECEIVED", validFrom: [] }],
              },
            ],
            questions: {
              $schema: "https://json-schema.org/draft/2020-12/schema",
              type: "object",
            },
          },
        ],
      },
    ]);
  });
});
