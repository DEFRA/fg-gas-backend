import { describe, expect, it, vi } from "vitest";
import { Grant } from "../models/grant.js";
import { save } from "../repositories/grant.repository.js";
import { createGrantUseCase } from "./create-grant.use-case.js";

vi.mock("../repositories/grant.repository.js");

describe("createGrantUseCase", () => {
  it("creates a grant", async () => {
    const grant = await createGrantUseCase({
      code: "test-grant",
      metadata: {
        description: "Test Grant Description",
        startDate: "2023-01-01T00:00:00Z",
      },
      actions: [
        { name: "action1", method: "POST", url: "http://example.com/action1" },
        { name: "action2", method: "GET", url: "http://example.com/action2" },
      ],
      questions: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
      },
    });

    expect(save).toHaveBeenCalledWith(grant);

    expect(grant).toStrictEqual(
      new Grant({
        code: "test-grant",
        metadata: {
          description: "Test Grant Description",
          startDate: "2023-01-01T00:00:00Z",
        },
        actions: [
          {
            name: "action1",
            method: "POST",
            url: "http://example.com/action1",
          },
          { name: "action2", method: "GET", url: "http://example.com/action2" },
        ],
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
        },
      }),
    );
  });
});
