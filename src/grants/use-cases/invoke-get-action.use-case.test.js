import { describe, expect, it, vi } from "vitest";
import { wreck } from "../../common/wreck.js";
import { Grant } from "../models/grant.js";
import { findGrantByCodeUseCase } from "./find-grant-by-code.use-case.js";
import { invokeGetActionUseCase } from "./invoke-get-action.use-case.js";

vi.mock("./find-grant-by-code.use-case.js");
vi.mock("../../common/wreck.js");

describe("invokeGetActionUseCase", () => {
  it("invokes a GET action to the grant", async () => {
    givenGrantWithActions([
      {
        method: "GET",
        name: "get-test",
        url: "http://localhost:3002/test-grant-1/get-test",
      },
    ]);

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

  it("invokes a GET action with path parameters to the grant", async () => {
    givenGrantWithActions([
      {
        method: "GET",
        name: "get-test",
        url: "http://localhost:3002/test-grant-1/get-test/$pathParam",
      },
    ]);

    wreck.get.mockResolvedValue({
      payload: {
        message: "Action invoked",
      },
    });

    const result = await invokeGetActionUseCase({
      code: "test-grant-1",
      name: "get-test",
      params: { pathParam: "ABC123", anotherPathParam: "XYZ789" },
    });

    expect(result).toEqual({
      message: "Action invoked",
    });

    expect(wreck.get).toHaveBeenCalledWith(
      "http://localhost:3002/test-grant-1/get-test/ABC123?code=test-grant-1&anotherPathParam=XYZ789",
      { json: true },
    );
  });

  it("invokes a GET action ERRORS without required parameters to the grant", async () => {
    givenGrantWithActions([
      {
        method: "GET",
        name: "get-test",
        url: "http://localhost:3002/test-grant-1/get-test/$pathParam",
      },
    ]);

    wreck.get.mockResolvedValue({
      payload: {
        message: "Action invoked",
      },
    });

    await expect(
      invokeGetActionUseCase({
        code: "test-grant-1",
        name: "get-test",
        params: { anotherPathParam: "XYZ789" },
      }),
    ).rejects.toThrow(
      'Grant with code "test-grant-1" has unresolved placeholders in the URL: $pathParam',
    );

    expect(wreck.get).toHaveBeenCalledTimes(0);
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
    givenGrantWithActions([
      {
        method: "GET",
        name: "get-test",
        url: "http://localhost:3002/test-grant-1/get-test",
      },
    ]);

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
