import { describe, expect, it, vi } from "vitest";
import { Grant } from "../models/grant.ts";
import { findAll } from "../repositories/grant.repository.js";
import { findGrantsUseCase } from "./find-grants.use-case.js";

vi.mock("../repositories/grant.repository.js");

describe("findGrantsUseCase", () => {
  it("finds grants", async () => {
    const grant1 = new Grant({
      code: "test-grant-1",
      metadata: {
        description: "Test 1",
        startDate: "2023-01-01T00:00:00Z",
      },
      actions: [],
      questions: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
      },
    });

    const grant2 = new Grant({
      code: "test-grant-2",
      metadata: {
        description: "Test 2",
        startDate: "2023-02-01T00:00:00Z",
      },
      actions: [],
      questions: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
      },
    });

    findAll.mockResolvedValue([grant1, grant2]);

    const results = await findGrantsUseCase("test-grant");

    expect(results).toStrictEqual([grant1, grant2]);
  });
});
