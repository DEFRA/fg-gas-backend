import { describe, expect, it, vi } from "vitest";
import { Grant } from "../models/grant.ts";
import { findByCode } from "../repositories/grant.repository.js";
import { findGrantByCodeUseCase } from "./find-grant-by-code.use-case.js";

vi.mock("../repositories/grant.repository.js");

describe("findGrantByCodeUseCase", () => {
  it("finds a grant by code", async () => {
    const grant = new Grant({
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
    });

    findByCode.mockResolvedValue(grant);

    const result = await findGrantByCodeUseCase("test-grant");

    expect(result).toStrictEqual(grant);
  });

  it("throws when grant not found", async () => {
    findByCode.mockResolvedValue(null);

    await expect(findGrantByCodeUseCase("non-existent-grant")).rejects.toThrow(
      "Grant with code non-existent-grant not found",
    );
  });
});
