import { describe, expect, it, vi } from "vitest";
import { wreck } from "../../common/wreck.js";
import { Grant } from "../models/grant.js";
import { findGrantByCodeUseCase } from "./find-grant-by-code.use-case.js";
import { invokeActionUseCase } from "./invoke-action.use-case.js";

vi.mock("./find-grant-by-code.use-case.js");
vi.mock("../../common/wreck.js");

describe("invokeActionUseCase", () => {
  it("invokes a GET action", async () => {
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

    const result = await invokeActionUseCase({
      code: "test-grant-1",
      name: "get-test",
      method: "GET",
    });

    expect(result).toEqual({
      message: "Action invoked",
    });

    expect(wreck.get).toHaveBeenCalledWith(
      "http://localhost:3002/test-grant-1/get-test?code=test-grant-1",
      { json: true },
    );
  });

  it("invokes a POST action", async () => {
    givenGrantWithActions([
      {
        method: "POST",
        name: "post-test",
        url: "http://localhost:3002/test-grant-1/post-test",
      },
    ]);

    wreck.post.mockResolvedValue({
      payload: {
        message: "Action invoked",
      },
    });

    const result = await invokeActionUseCase({
      code: "test-grant-1",
      name: "post-test",
      method: "POST",
      payload: { someData: "test" },
    });

    expect(result).toEqual({
      message: "Action invoked",
    });

    expect(wreck.post).toHaveBeenCalledWith(
      "http://localhost:3002/test-grant-1/post-test?code=test-grant-1",
      {
        json: true,
        payload: { someData: "test" },
      },
    );
  });

  it("warns throws if the method is not supported", async () => {
    givenGrantWithActions([
      {
        method: "METHOD",
        name: "test",
        url: "http://localhost:3002/test-grant-1/put-test",
      },
    ]);

    await expect(
      invokeActionUseCase({
        code: "test-grant-1",
        name: "test",
        method: "METHOD",
        params: { anotherPathParam: "XYZ789" },
      }),
    ).rejects.toThrow('Unsupported method METHOD for action named "test"');

    expect(wreck.get).toHaveBeenCalledTimes(0);
  });

  it("invokes a GET action with path parameters", async () => {
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

    const result = await invokeActionUseCase({
      code: "test-grant-1",
      name: "get-test",
      method: "GET",
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

  it("invokes a GET action with for a CDP environment", async () => {
    givenGrantWithActions([
      {
        method: "GET",
        name: "get-test",
        url: "http://my-grant-specific-service.%ENVIRONMENT%.gov.uk/test-grant-1/get-test/$pathParam",
      },
    ]);

    wreck.get.mockResolvedValue({
      payload: {
        message: "Action invoked",
      },
    });

    const result = await invokeActionUseCase({
      code: "test-grant-1",
      name: "get-test",
      method: "GET",
      params: { pathParam: "ABC123", anotherPathParam: "XYZ789" },
    });

    expect(result).toEqual({
      message: "Action invoked",
    });

    expect(wreck.get).toHaveBeenCalledWith(
      "http://my-grant-specific-service.local.gov.uk/test-grant-1/get-test/ABC123?code=test-grant-1&anotherPathParam=XYZ789",
      { json: true },
    );
  });

  it("invokes a POST action with path parameters", async () => {
    givenGrantWithActions([
      {
        method: "POST",
        name: "post-test",
        url: "http://localhost:3002/test-grant-1/post-test/$pathParam",
      },
    ]);

    wreck.post.mockResolvedValue({
      payload: {
        message: "POST Action with payload invoked",
      },
    });

    const result = await invokeActionUseCase({
      code: "test-grant-1",
      name: "post-test",
      method: "POST",
      params: { pathParam: "ABC123", anotherParam: "XYZ789" },
      payload: { someData: "test" },
    });

    expect(result).toEqual({
      message: "POST Action with payload invoked",
    });

    expect(wreck.post).toHaveBeenCalledWith(
      "http://localhost:3002/test-grant-1/post-test/ABC123?code=test-grant-1&anotherParam=XYZ789",
      {
        json: true,
        payload: { someData: "test" },
      },
    );
  });

  it("throws when required parameters are missing", async () => {
    givenGrantWithActions([
      {
        method: "GET",
        name: "get-test",
        url: "http://localhost:3002/test-grant-1/get-test/$pathParam",
      },
    ]);

    await expect(
      invokeActionUseCase({
        code: "test-grant-1",
        name: "get-test",
        method: "GET",
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
      invokeActionUseCase({
        code: "non-existent-grant",
        name: "get-test",
        method: "GET",
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
      invokeActionUseCase({
        code: "test-grant-2",
        name: "get-non-existent-action",
        method: "GET",
      }),
    ).rejects.toThrow(
      'Grant with code "test-grant-2" has no GET action named "get-non-existent-action"',
    );
  });
});

const givenGrantWithActions = (actions) => {
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
};
