import { describe, it, expect, vi } from "vitest";
import { wreck } from "../common/wreck.js";
import * as Grant from "./grant.js";
import * as grantRepository from "./grant-repository.js";
import * as grantService from "./grant-service.js";

vi.mock("../common/wreck.js", () => ({
  wreck: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock("./grant.js", () => ({
  create: vi.fn(),
  validateCode: vi.fn(),
  validateActionName: vi.fn(),
  validateActionPayload: vi.fn(),
}));

vi.mock("./grant-repository.js", () => ({
  add: vi.fn(),
  findAll: vi.fn(),
  findByCode: vi.fn(),
}));

describe("create", () => {
  it("stores the grant in the repository", async () => {
    const grant = {
      code: "grant-code",
      name: "test",
      actions: [
        {
          method: "GET",
          name: "test",
          url: "http://localhost",
        },
      ],
    };

    Grant.create.mockReturnValueOnce(grant);

    const result = await grantService.create({
      code: "grant-code",
      name: "test",
      actions: [
        {
          method: "GET",
          name: "test",
          url: "http://localhost",
        },
      ],
    });

    expect(Grant.create).toHaveBeenCalledWith(grant);
    expect(grantRepository.add).toHaveBeenCalledWith(grant);
    expect(result).toEqual(grant);
  });
});

describe("findAll", () => {
  it("returns all grants from the repository", async () => {
    const grants = [
      {
        code: "1",
        name: "test 1",
        actions: [],
      },
      {
        code: "2",
        name: "test 2",
        actions: [],
      },
    ];

    grantRepository.findAll.mockResolvedValueOnce(grants);

    const result = await grantService.findAll();

    expect(result).toEqual(grants);
  });
});

describe("findByCode", () => {
  it("returns the grant from the repository", async () => {
    const grant = {
      code: "1",
      name: "test 1",
      actions: [],
    };

    grantRepository.findByCode.mockResolvedValueOnce(grant);

    const result = await grantService.findByCode("1");

    expect(Grant.validateCode).toHaveBeenCalledWith("1");
    expect(grantRepository.findByCode).toHaveBeenCalledWith("1");
    expect(result).toEqual(grant);
  });

  it("throws when the grant is not found", async () => {
    grantRepository.findByCode.mockResolvedValueOnce(null);

    await expect(grantService.findByCode("1")).rejects.toThrow(
      'Grant with code "1" not found',
    );
  });
});

describe("invokeGetAction", () => {
  it("invokes the GET action", async () => {
    grantRepository.findByCode.mockResolvedValueOnce({
      actions: [
        {
          method: "GET",
          name: "test",
          url: "http://localhost",
        },
      ],
    });

    const response = {
      arbitrary: "response",
    };

    wreck.get.mockResolvedValueOnce({
      payload: response,
    });

    const result = await grantService.invokeGetAction({
      code: "1",
      name: "test",
    });

    expect(wreck.get).toHaveBeenCalledWith("http://localhost?code=1", {
      json: true,
    });
    expect(result).toEqual(response);
  });

  it("throws when the grant is not found", async () => {
    grantRepository.findByCode.mockResolvedValueOnce(null);

    await expect(
      grantService.invokeGetAction({
        code: "1",
        name: "test",
      }),
    ).rejects.toThrow('Grant with code "1" not found');

    expect(wreck.get).not.toHaveBeenCalled();
  });

  it("throws when the action is not found", async () => {
    grantRepository.findByCode.mockResolvedValueOnce({
      code: "1",
      name: "Test",
      actions: [],
    });

    await expect(
      grantService.invokeGetAction({
        code: "1",
        name: "test",
      }),
    ).rejects.toThrow('Grant with code "1" has no GET action named "test"');

    expect(wreck.get).not.toHaveBeenCalled();
  });
});

describe("invokePostAction", () => {
  it("invokes the POST action", async () => {
    grantRepository.findByCode.mockResolvedValueOnce({
      code: "1",
      name: "Test",
      actions: [
        {
          method: "POST",
          name: "test",
          url: "http://localhost",
        },
      ],
    });

    wreck.post.mockResolvedValueOnce({
      payload: {
        arbitrary: "response",
      },
    });

    const result = await grantService.invokePostAction({
      code: "1",
      name: "test",
      payload: {
        code: "1",
        name: "test",
      },
    });

    expect(wreck.post).toHaveBeenCalledWith("http://localhost", {
      payload: {
        code: "1",
        name: "test",
      },
      json: true,
    });

    expect(result).toEqual({
      arbitrary: "response",
    });
  });

  it("throws when the grant is not found", async () => {
    grantRepository.findByCode.mockResolvedValueOnce(null);

    await expect(
      grantService.invokePostAction({
        code: "1",
        name: "test",
        payload: {
          code: "1",
          name: "test",
        },
      }),
    ).rejects.toThrow('Grant with code "1" not found');

    expect(wreck.post).not.toHaveBeenCalled();
  });

  it("throws when the action is not found", async () => {
    grantRepository.findByCode.mockResolvedValueOnce({
      code: "1",
      name: "Test",
      actions: [],
    });

    await expect(
      grantService.invokePostAction({
        code: "1",
        name: "test",
        payload: {
          code: "1",
          name: "test",
        },
      }),
    ).rejects.toThrow('Grant with code "1" has no POST action named "test"');

    expect(wreck.post).not.toHaveBeenCalled();
  });

  it("throws when the payload is invalid", async () => {
    Grant.validateCode.mockImplementationOnce(() => {
      throw new Error("Invalid request payload input");
    });

    await expect(
      grantService.invokePostAction({
        code: "1",
        name: "test",
        payload: {
          code: "1",
          name: "test",
        },
      }),
    ).rejects.toThrow("Invalid request payload input");

    expect(wreck.post).not.toHaveBeenCalled();
  });
});
