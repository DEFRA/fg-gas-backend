import Boom from "@hapi/boom";
import { describe, expect, it, vi } from "vitest";
import { Grant } from "../models/grant.js";
import { findByCode, replace } from "../repositories/grant.repository.js";
import { replaceGrantUseCase } from "./replace-grant.use-case.js";

vi.mock("../repositories/grant.repository.js");

describe("replaceGrantUseCase", () => {
  it("replaces the whole grant", async () => {
    findByCode.mockResolvedValue(
      new Grant({
        code: "test-grant",
        version: "0.0.0",
        metadata: {
          description: "Test Grant Description",
          startDate: "2023-01-01T00:00:00Z",
        },
        actions: [],
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
        },
      }),
    );

    await replaceGrantUseCase("test-grant", {
      code: "test-grant",
      metadata: {
        description: "Updated Test Grant Description",
        startDate: "2023-01-02T00:00:00Z",
      },
      actions: [
        {
          method: "GET",
          name: "get-test",
          url: "http://localhost:3002/test-grant/get-test",
        },
      ],
      questions: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
      },
    });

    expect(replace).toHaveBeenCalledWith(
      new Grant({
        code: "test-grant",
        version: "0.0.0",
        metadata: {
          description: "Updated Test Grant Description",
          startDate: "2023-01-02T00:00:00Z",
        },
        actions: [
          {
            method: "GET",
            name: "get-test",
            url: "http://localhost:3002/test-grant/get-test",
          },
        ],
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
        },
      }),
    );
  });

  it("throws notFound when grant does not exist at target version", async () => {
    findByCode.mockResolvedValue(null);

    await expect(
      replaceGrantUseCase("test-grant", {
        code: "test-grant",
        version: "2.0.0",
        metadata: {
          description: "Test",
          startDate: "2023-01-01T00:00:00Z",
        },
        actions: [],
      }),
    ).rejects.toThrow(
      Boom.notFound('Grant with code "test-grant" version "2.0.0" not found'),
    );

    expect(findByCode).toHaveBeenCalledWith("test-grant", "2.0.0");
    expect(replace).not.toHaveBeenCalled();
  });

  it("replaces the grant with externalStatusMap", async () => {
    findByCode.mockResolvedValue(
      new Grant({
        code: "test-grant",
        version: "0.0.0",
        metadata: {
          description: "Test Grant Description",
          startDate: "2023-01-01T00:00:00Z",
        },
        actions: [],
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
        },
      }),
    );

    await replaceGrantUseCase("test-grant", {
      code: "test-grant",
      metadata: {
        description: "Updated Test Grant Description",
        startDate: "2023-01-02T00:00:00Z",
      },
      actions: [
        {
          method: "GET",
          name: "get-test",
          url: "http://localhost:3002/test-grant/get-test",
        },
      ],
      questions: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
      },
      externalStatusMap: {
        phases: [
          {
            code: "PRE_AWARD",
            stages: [
              {
                code: "REVIEW",
                statuses: [
                  {
                    code: "IN_PROGRESS",
                    source: "CW",
                    mappedTo: "IN_PROGRESS",
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    expect(replace).toHaveBeenCalledWith(
      new Grant({
        code: "test-grant",
        version: "0.0.0",
        metadata: {
          description: "Updated Test Grant Description",
          startDate: "2023-01-02T00:00:00Z",
        },
        actions: [
          {
            method: "GET",
            name: "get-test",
            url: "http://localhost:3002/test-grant/get-test",
          },
        ],
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
        },
        externalStatusMap: {
          phases: [
            {
              code: "PRE_AWARD",
              stages: [
                {
                  code: "REVIEW",
                  statuses: [
                    {
                      code: "IN_PROGRESS",
                      source: "CW",
                      mappedTo: "IN_PROGRESS",
                    },
                  ],
                },
              ],
            },
          ],
        },
      }),
    );
  });
});
