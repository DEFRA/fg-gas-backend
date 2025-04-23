import { describe, it, expect, vi } from "vitest";
import { wreck } from "../common/wreck.js";
import { createGrant } from "./grant.js";
import * as grantRepository from "./grant-repository.js";
import * as applicationRepository from "./application-repository.js";
import * as grantService from "./grant-service.js";
import * as snsLib from "./../common/sns.js";
import { config } from "../common/config.js";

vi.mock("../common/wreck.js", () => ({
  wreck: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock("../common/sns.js", () => ({
  publish: vi.fn(),
}));

vi.mock("./grant.js", () => ({
  createGrant: vi.fn(),
}));

vi.mock("./grant-repository.js", () => ({
  add: vi.fn(),
  findAll: vi.fn(),
  findByCode: vi.fn(),
}));

vi.mock("./application-repository.js", () => ({
  add: vi.fn(),
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

    createGrant.mockReturnValueOnce(grant);

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

    expect(createGrant).toHaveBeenCalledWith(grant);
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
});

describe("submitApplication", () => {
  it("submits the application", async () => {
    grantRepository.findByCode.mockResolvedValueOnce({
      code: "grant-1",
      questions: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: {
          question1: {
            type: "string",
          },
          question2: {
            type: "number",
          },
        },
        required: ["question1", "question2"],
      },
    });

    await grantService.submitApplication("grant-1", {
      metadata: {
        clientRef: "12345",
        submittedAt: new Date(),
        sbi: "1234567890",
        frn: "1234567890",
        crn: "1234567890",
        defraId: "1234567890",
      },
      answers: {
        question1: "answer1",
        question2: 42,
      },
    });

    expect(applicationRepository.add).toHaveBeenCalledWith({
      code: "grant-1",
      clientRef: "12345",
      submittedAt: expect.any(Date),
      createdAt: expect.any(Date),
      identifiers: {
        sbi: "1234567890",
        frn: "1234567890",
        crn: "1234567890",
        defraId: "1234567890",
      },
      answers: {
        question1: "answer1",
        question2: 42,
      },
    });

    expect(snsLib.publish).toHaveBeenCalledWith(
      config.grantApplicationCreatedTopic,
      {
        code: "grant-1",
        createdAt: expect.any(Date),
        submittedAt: expect.any(Date),
        clientRef: "12345",
        identifiers: {
          sbi: "1234567890",
          frn: "1234567890",
          crn: "1234567890",
          defraId: "1234567890",
        },
        answers: {
          question1: "answer1",
          question2: 42,
        },
      },
    );
  });

  it("throws when the grant is not found", async () => {
    grantRepository.findByCode.mockResolvedValueOnce(null);

    await expect(
      grantService.submitApplication("grant-1", {
        metadata: {
          clientRef: "12345",
          submittedAt: new Date(),
          sbi: "1234567890",
          frn: "1234567890",
          crn: "1234567890",
          defraId: "1234567890",
        },
        answers: {
          question1: "answer1",
          question2: 42,
        },
      }),
    ).rejects.toThrow('Grant with code "grant-1" not found');
  });
});
