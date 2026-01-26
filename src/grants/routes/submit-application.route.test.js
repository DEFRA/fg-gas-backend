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
import { submitApplicationUseCase } from "../use-cases/submit-application.use-case.js";
import { submitApplicationRoute } from "./submit-application.route.js";

vi.mock("../use-cases/submit-application.use-case.js");

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
