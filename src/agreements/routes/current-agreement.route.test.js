import hapi from "@hapi/hapi";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  getCurrentAgreementUseCase,
  postCurrentAgreementUseCase,
} from "../use-cases/current-agreement.use-case.js";
import {
  currentAgreementGetRoute,
  currentAgreementPostRoute,
} from "./current-agreement.route.js";

vi.mock("../use-cases/current-agreement.use-case.js");

let server;

beforeAll(async () => {
  server = hapi.server();
  server.route([currentAgreementGetRoute, currentAgreementPostRoute]);
  await server.initialize();
});

afterAll(async () => {
  await server.stop();
});

describe("currentAgreement routes", () => {
  it("renders the current Agreement by application identity", async () => {
    getCurrentAgreementUseCase.mockResolvedValue({
      renderMode: "form",
      formDefinition: {
        name: "Agreement",
        pages: [{ path: "/agreement", components: [] }],
      },
    });

    const { statusCode, result } = await server.inject({
      method: "GET",
      url: "/agreements/current?code=pigs-might-fly&clientRef=ref-123&sbi=123456789&mode=print",
    });

    expect(statusCode).toBe(200);
    expect(result.renderMode).toBe("form");
    expect(getCurrentAgreementUseCase).toHaveBeenCalledWith({
      clientRef: "ref-123",
      code: "pigs-might-fly",
      mode: "print",
      sbi: "123456789",
    });
  });

  it("posts a hosted Agreement action by application identity", async () => {
    postCurrentAgreementUseCase.mockResolvedValue({
      renderMode: "form",
      formDefinition: {
        name: "Agreement",
        pages: [{ path: "/agreement", components: [] }],
      },
    });

    const { statusCode, result } = await server.inject({
      method: "POST",
      url: "/agreements/current?code=pigs-might-fly&clientRef=ref-123&sbi=123456789",
      payload: {
        action: "display-accept",
        formData: {},
      },
    });

    expect(statusCode).toBe(200);
    expect(result.renderMode).toBe("form");
    expect(postCurrentAgreementUseCase).toHaveBeenCalledWith({
      action: "display-accept",
      clientRef: "ref-123",
      code: "pigs-might-fly",
      formData: {},
      sbi: "123456789",
    });
  });

  it("returns no content for a successful hosted Agreement action", async () => {
    postCurrentAgreementUseCase.mockResolvedValue({ statusCode: 204 });

    const { statusCode, payload } = await server.inject({
      method: "POST",
      url: "/agreements/current?code=pigs-might-fly&clientRef=ref-123&sbi=123456789",
      payload: {
        action: "validate-accept-offer",
        formData: {
          confirm: "confirmed",
        },
      },
    });

    expect(statusCode).toBe(204);
    expect(payload).toBe("");
  });
});
