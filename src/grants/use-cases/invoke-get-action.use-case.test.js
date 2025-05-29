import { describe, expect, it, vi } from "vitest";
import { wreck } from "../../common/wreck.js";
import { Grant } from "../models/grant.js";
import { findGrantByCodeUseCase } from "./find-grant-by-code.use-case.js";
import { invokeGetActionUseCase } from "./invoke-get-action.use-case.js";

vi.mock("./find-grant-by-code.use-case.js");
vi.mock("../../common/wreck.js");

describe("invokeGetActionUseCase", () => {
  it("invokes a GET action to the grant", async () => {
    const grant = new Grant({
      code: "test-grant-1",
      metadata: {
        description: "Test 1",
        startDate: "2023-01-01T00:00:00Z",
      },
      actions: [
        {
          method: "GET",
          name: "get-test",
          url: "http://localhost:3002/test-grant-1/get-test",
        },
      ],
      questions: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
      },
    });

    findGrantByCodeUseCase.mockResolvedValue(grant);

    wreck.get.mockResolvedValue({
      payload: {
        message: "Action invoked",
      },
    });

    const result = await invokeGetActionUseCase({
      code: "test-grant-1",
      name: "get-test",
    });

    expect(result).toEqual({
      message: "Action invoked",
    });

    expect(wreck.get).toHaveBeenCalledWith(
      "http://localhost:3002/test-grant-1/get-test?code=test-grant-1",
      { json: true },
    );
  });

  it("throws when the grant does not exist", async () => {
    findGrantByCodeUseCase.mockRejectedValue(
      new Error("Grant with code non-existent-grant not found"),
    );

    await expect(
      invokeGetActionUseCase({
        code: "non-existent-grant",
        name: "get-test",
      }),
    ).rejects.toThrow("Grant with code non-existent-grant not found");
  });

  it("throws when the action does not exist", async () => {
    const grant = new Grant({
      code: "test-grant-1",
      metadata: {
        description: "Test 1",
        startDate: "2023-01-01T00:00:00Z",
      },
      actions: [
        {
          method: "GET",
          name: "get-test",
          url: "http://localhost:3002/test-grant-1/get-test",
        },
      ],
      questions: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
      },
    });

    findGrantByCodeUseCase.mockResolvedValue(grant);

    await expect(
      invokeGetActionUseCase({
        code: "test-grant-2",
        name: "get-non-existent-action",
      }),
    ).rejects.toThrow(
      'Grant with code "test-grant-2" has no GET action named "get-non-existent-action"',
    );
  });
});
