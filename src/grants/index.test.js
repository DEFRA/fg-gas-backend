import { describe, it, expect, vi, beforeAll } from "vitest";
import hapi from "@hapi/hapi";
import { grantsPlugin } from "./index.js";
import * as grantService from "./grant-service.js";

vi.mock("./grant-service.js", () => ({
  create: vi.fn(),
  findAll: vi.fn(),
  findByCode: vi.fn(),
  invokeGetAction: vi.fn(),
  invokePostAction: vi.fn(),
  submitApplication: vi.fn(),
}));

vi.mock("../common/db.js", () => ({
  db: {
    createIndex: vi.fn(),
  },
}));

let server;

beforeAll(async () => {
  server = hapi.server();
  await server.register(grantsPlugin);
  await server.initialize();
});

describe("POST /grants", () => {
  it("creates a new grant and returns the id", async () => {
    const createGrantRequest = {
      code: "test",
      metadata: {
        description: "test",
        startDate: "2100-01-01T00:00:00.000Z",
      },
      actions: [],
      questions: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
      },
    };

    grantService.create.mockResolvedValueOnce(createGrantRequest);

    const { statusCode, result } = await server.inject({
      method: "POST",
      url: "/grants",
      payload: createGrantRequest,
    });

    expect(statusCode).toEqual(201);

    expect(grantService.create).toHaveBeenCalledWith({
      code: "test",
      metadata: {
        description: "test",
        startDate: new Date("2100-01-01T00:00:00.000Z"),
      },
      actions: [],
      questions: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
      },
    });
    expect(result).toEqual({
      code: "test",
    });
  });
});

describe("GET /grants", () => {
  it("returns all grants", async () => {
    grantService.findAll.mockResolvedValueOnce([
      {
        code: "1",
        metadata: {
          description: "test 1",
          startDate: "2100-01-01T00:00:00.000Z",
        },
        actions: [],
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
        },
        internal: "this is private",
      },
      {
        code: "2",
        metadata: {
          description: "test 2",
          startDate: "2100-01-01T00:00:00.000Z",
        },
        actions: [],
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
        },
        internal: "this is private",
      },
    ]);

    const { statusCode, result } = await server.inject({
      method: "GET",
      url: "/grants",
    });

    expect(statusCode).toEqual(200);

    expect(result).toEqual([
      {
        code: "1",
        metadata: {
          description: "test 1",
          startDate: "2100-01-01T00:00:00.000Z",
        },
        actions: [],
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
        },
      },
      {
        code: "2",
        metadata: {
          description: "test 2",
          startDate: "2100-01-01T00:00:00.000Z",
        },
        actions: [],
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
        },
      },
    ]);
  });
});

describe("GET /grants/{code}", () => {
  it("returns matching grant", async () => {
    grantService.findByCode.mockResolvedValueOnce({
      code: "adding-value",
      metadata: {
        description: "test 1",
        startDate: "2100-01-01T00:00:00.000Z",
      },
      actions: [],
      questions: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
      },
      internal: "this is private",
    });

    const { statusCode, result } = await server.inject({
      method: "GET",
      url: "/grants/adding-value",
    });

    expect(statusCode).toEqual(200);

    expect(result).toEqual({
      code: "adding-value",
      metadata: {
        description: "test 1",
        startDate: "2100-01-01T00:00:00.000Z",
      },
      actions: [],
      questions: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
      },
    });
  });
});

describe("GET /grants/{code}/actions/{name}/invoke", () => {
  it("returns response from action", async () => {
    grantService.invokeGetAction.mockResolvedValueOnce({
      arbitrary: "result",
    });

    const { statusCode, result } = await server.inject({
      method: "GET",
      url: "/grants/adding-value/actions/test/invoke",
    });

    expect(statusCode).toEqual(200);

    expect(result).toEqual({
      arbitrary: "result",
    });

    expect(grantService.invokeGetAction).toHaveBeenCalledWith({
      code: "adding-value",
      name: "test",
    });
  });
});

describe("POST /grants/{code}/actions/{name}/invoke", () => {
  it("returns response from action", async () => {
    grantService.invokePostAction.mockResolvedValueOnce({
      arbitrary: "result",
    });

    const { statusCode, result } = await server.inject({
      method: "POST",
      url: "/grants/adding-value/actions/test/invoke",
      payload: {
        code: "adding-value",
        name: "test",
      },
    });

    expect(statusCode).toEqual(200);

    expect(result).toEqual({
      arbitrary: "result",
    });

    expect(grantService.invokePostAction).toHaveBeenCalledWith({
      code: "adding-value",
      name: "test",
      payload: {
        code: "adding-value",
        name: "test",
      },
    });
  });
});

describe("POST /grants/{code}/applications", () => {
  it("returns the application id", async () => {
    const submittedAt = new Date();

    const { statusCode, result } = await server.inject({
      method: "POST",
      url: "/grants/adding-value/applications",
      payload: {
        metadata: {
          clientRef: "client-1",
          submittedAt,
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
    });

    expect(statusCode).toEqual(201);

    expect(grantService.submitApplication).toHaveBeenCalledWith(
      "adding-value",
      {
        answers: {
          question1: "answer1",
          question2: 42,
        },
        metadata: {
          clientRef: "client-1",
          crn: "1234567890",
          defraId: "1234567890",
          frn: "1234567890",
          sbi: "1234567890",
          submittedAt,
        },
      },
    );

    expect(result).toEqual({
      clientRef: "client-1",
    });
  });
});
