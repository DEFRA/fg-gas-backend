import { describe, expect, it, vi } from "vitest";
import { Grant } from "../models/grant.ts";
import { findByCode, replace } from "../repositories/grant.repository.js";
import { replaceGrantUseCase } from "./replace-grant.use-case.js";

vi.mock("../repositories/grant.repository.js");

describe("replaceGrantUseCase", () => {
  it("replaces the whole grant", async () => {
    findByCode.mockResolvedValue(
      new Grant({
        code: "test-grant",
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
});
