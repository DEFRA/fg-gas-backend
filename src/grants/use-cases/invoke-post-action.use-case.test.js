import { describe, expect, it, vi } from "vitest";
import { wreck } from "../../common/wreck.js";
import { Grant } from "../models/grant.js";
import { findGrantByCodeUseCase } from "./find-grant-by-code.use-case.js";
import { invokePostActionUseCase } from "./invoke-post-action.use-case.js";

vi.mock("./find-grant-by-code.use-case.js");
vi.mock("../../common/wreck.js");

describe("invokePostActionUseCase", () => {
  it("invokes a POST action to the grant", async () => {
    const actions = [
      {
        method: "POST",
        name: "post-test",
        url: "http://localhost:3002/test-grant-1/post-test",
      },
    ];
    givenGrantWithActions(actions);

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

  it("invokes a POST action with parameters to the grant", async () => {
    const actions = [
      {
        method: "POST",
        name: "post-test",
        url: "http://localhost:3002/test-grant-1/post-test/$pathParam",
      },
    ];

    givenGrantWithActions(actions);

    wreck.post.mockResolvedValue({
      payload: {
        message: "Action invoked",
      },
    });

    const result = await invokePostActionUseCase({
      code: "test-grant-1",
      name: "post-test",
      payload: { someData: "test" },
      params: {
        pathParam: "ABC123",
        otherParamOne: "value1",
        otherParamTwo: "value2",
      },
    });

    expect(result).toEqual({
      message: "Action invoked",
    });

    expect(wreck.post).toHaveBeenCalledWith(
      "http://localhost:3002/test-grant-1/post-test/ABC123?otherParamOne=value1&otherParamTwo=value2",
      {
        json: true,
        payload: { someData: "test" },
      },
    );
  });

  it("invokes a POST action ERRORS without required parameters to the grant", async () => {
    givenGrantWithActions([
      {
        method: "POST",
        name: "post-test",
        url: "http://localhost:3002/test-grant-1/post-test/$pathParam",
      },
    ]);

    wreck.post.mockResolvedValue({
      payload: {
        message: "Action invoked",
      },
    });

    await expect(
      invokePostActionUseCase({
        code: "test-grant-1",
        name: "post-test",
        payload: { someData: "test" },
        params: { otherParamOne: "value1", otherParamTwo: "value2" },
      }),
    ).rejects.toThrow(
      'Grant with code "test-grant-1" has unresolved placeholders in the URL: $pathParam',
    );

    expect(wreck.post).toHaveBeenCalledTimes(0);
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
    const actions = [
      {
        method: "GET",
        name: "post-test",
        url: "http://localhost:3002/test-grant-1/post-test",
      },
    ];
    givenGrantWithActions(actions);

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

function givenGrantWithActions(actions) {
  const grant = new Grant({
    code: "test-grant-1",
    metadata: {
      description: "Test 1",
      startDate: "2023-01-01T00:00:00Z",
    },
    actions,
    questions: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
    },
  });

  findGrantByCodeUseCase.mockResolvedValue(grant);
}
