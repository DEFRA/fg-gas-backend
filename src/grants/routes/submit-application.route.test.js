import Boom from "@hapi/boom";
import hapi from "@hapi/hapi";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { submitApplicationRequestSchema } from "../schemas/requests/submit-application-request.schema.js";
import { replaceApplicationUseCase } from "../use-cases/replace-application.use-case.js";
import { submitApplicationUseCase } from "../use-cases/submit-application.use-case.js";
import { submitApplicationRoute } from "./submit-application.route.js";

vi.mock("../use-cases/submit-application.use-case.js");
vi.mock("../use-cases/replace-application.use-case.js");

describe("submitApplicationRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.route(submitApplicationRoute);
    await server.initialize();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await server.stop();
  });

  it("submits an application for a grant", async () => {
    const { statusCode, result } = await server.inject({
      method: "POST",
      url: "/grants/test-grant/applications",
      payload: {
        metadata: {
          clientRef: "test-client-ref",
          sbi: "123456789",
          frn: "987654321",
          crn: "CRN123456",
          defraId: "DEFRA123456",
          submittedAt: "2000-01-01T12:00:00Z",
        },
        answers: {
          q1: "John Doe",
          q2: "30",
        },
      },
    });

    expect(statusCode).toBe(204);

    expect(result).toEqual(null);

    expect(submitApplicationUseCase).toHaveBeenCalledWith("test-grant", {
      metadata: {
        clientRef: "test-client-ref",
        sbi: "123456789",
        frn: "987654321",
        crn: "CRN123456",
        defraId: "DEFRA123456",
        submittedAt: new Date("2000-01-01T12:00:00Z"),
      },
      answers: {
        q1: "John Doe",
        q2: "30",
      },
    });
  });

  it("replaced an application for a grant", async () => {
    const { statusCode, result } = await server.inject({
      method: "POST",
      url: "/grants/test-grant/applications",
      payload: {
        metadata: {
          clientRef: "test-client-ref",
          previousClientRef: "prev-test-client-ref",
          sbi: "123456789",
          frn: "987654321",
          crn: "CRN123456",
          defraId: "DEFRA123456",
          submittedAt: "2000-01-01T12:00:00Z",
        },
        answers: {
          q1: "John Doe",
          q2: "30",
        },
      },
    });

    expect(statusCode).toBe(204);

    expect(result).toEqual(null);

    expect(replaceApplicationUseCase).toHaveBeenCalledWith("test-grant", {
      metadata: {
        clientRef: "test-client-ref",
        previousClientRef: "prev-test-client-ref",
        sbi: "123456789",
        frn: "987654321",
        crn: "CRN123456",
        defraId: "DEFRA123456",
        submittedAt: new Date("2000-01-01T12:00:00Z"),
      },
      answers: {
        q1: "John Doe",
        q2: "30",
      },
    });
  });

  it("submits an application and preserves extra metadata", async () => {
    const { statusCode } = await server.inject({
      method: "POST",
      url: "/grants/test-grant/applications",
      payload: {
        metadata: {
          clientRef: "test-client-ref",
          sbi: "123456789",
          frn: "987654321",
          crn: "CRN123456",
          wubble: "wobble",
          submittedAt: "2000-01-01T12:00:00Z",
        },
        answers: {
          q1: "John Doe",
        },
      },
    });

    expect(statusCode).toBe(204);

    expect(submitApplicationUseCase).toHaveBeenCalledWith("test-grant", {
      metadata: {
        clientRef: "test-client-ref",
        sbi: "123456789",
        frn: "987654321",
        crn: "CRN123456",
        wubble: "wobble",
        submittedAt: new Date("2000-01-01T12:00:00Z"),
      },
      answers: {
        q1: "John Doe",
      },
    });
  });

  it("validates the payload using submitApplicationRequestSchema", async () => {
    expect(submitApplicationRoute.options.validate.payload).toBe(
      submitApplicationRequestSchema,
    );
  });

  it("returns 409 when replacing an application that does not allow replacement", async () => {
    replaceApplicationUseCase.mockRejectedValue(
      Boom.conflict(
        "Can not replace existing Application with clientRef: prev-test-client-ref - replacement is not allowed",
      ),
    );

    const { statusCode, result } = await server.inject({
      method: "POST",
      url: "/grants/test-grant/applications",
      payload: {
        metadata: {
          clientRef: "test-client-ref",
          previousClientRef: "prev-test-client-ref",
          sbi: "123456789",
          frn: "987654321",
          crn: "CRN123456",
          defraId: "DEFRA123456",
          submittedAt: "2000-01-01T12:00:00Z",
        },
        answers: {
          q1: "John Doe",
        },
      },
    });

    expect(statusCode).toBe(409);
    expect(result.message).toContain("prev-test-client-ref");
    expect(submitApplicationUseCase).not.toHaveBeenCalled();
  });

  it("returns 400 when payload is invalid", async () => {
    const { statusCode, result } = await server.inject({
      method: "POST",
      url: "/grants/test-grant/applications",
      payload: {
        metadata: {
          clientRef: "test-client-ref",
          sbi: "123456789",
          frn: "987654321",
          crn: "CRN123456",
          defraId: "DEFRA123456",
          submittedAt: "invalid-date",
        },
        answers: {
          q1: "John Doe",
        },
      },
    });

    expect(statusCode).toBe(400);
    expect(result.message).toEqual("Invalid request payload input");
  });
});
