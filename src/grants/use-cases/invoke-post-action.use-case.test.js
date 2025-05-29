import { describe, expect, it, vi } from "vitest";
import { wreck } from "../../common/wreck.js";
import { Grant } from "../models/grant.js";
import { findGrantByCodeUseCase } from "./find-grant-by-code.use-case.js";
import { invokePostActionUseCase } from "./invoke-post-action.use-case.js";

vi.mock("./find-grant-by-code.use-case.js");
vi.mock("../../common/wreck.js");

describe("invokePostActionUseCase", () => {
  it("invokes a POST action to the grant", async () => {
    const grant = new Grant({
      code: "test-grant-1",
      metadata: {
        description: "Test 1",
        startDate: "2023-01-01T00:00:00Z",
      },
      actions: [
        {
          method: "POST",
          name: "post-test",
          url: "http://localhost:3002/test-grant-1/post-test",
        },
      ],
      questions: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
      },
    });

    findGrantByCodeUseCase.mockResolvedValue(grant);

    wreck.post.mockResolvedValue({
      payload: {
        message: "Action invoked",
      },
    });

    const result = await invokePostActionUseCase({
      code: "test-grant-1",
      name: "post-test",
      payload: { someData: "test" },
    });

    expect(result).toEqual({
      message: "Action invoked",
    });

    expect(wreck.post).toHaveBeenCalledWith(
      "http://localhost:3002/test-grant-1/post-test",
      {
        json: true,
        payload: { someData: "test" },
      },
    );
  });

  it("throws when the grant does not exist", async () => {
    findGrantByCodeUseCase.mockRejectedValue(
      new Error("Grant with code non-existent-grant not found"),
    );

    await expect(
      invokePostActionUseCase({
        code: "non-existent-grant",
        name: "post-test",
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
          name: "post-test",
          url: "http://localhost:3002/test-grant-1/post-test",
        },
      ],
      questions: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
      },
    });

    findGrantByCodeUseCase.mockResolvedValue(grant);

    await expect(
      invokePostActionUseCase({
        code: "test-grant-2",
        name: "get-non-existent-action",
      }),
    ).rejects.toThrow(
      'Grant with code "test-grant-2" has no POST action named "get-non-existent-action"',
    );
  });
});
