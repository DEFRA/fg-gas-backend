import hapi from "@hapi/hapi";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getApplicationStatusUseCase } from "../use-cases/get-application-status.use-case.js";
import { applicationStatusRoute } from "./application-status.route.js";

vi.mock("../use-cases/get-application-status.use-case.js");

describe("applicationStatusRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.route(applicationStatusRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  it.only("fetches the application status for grantCode and clientRef", async () => {
    const code = "grant-1";
    const clientRef = "ref-1234";

    getApplicationStatusUseCase.mockResolvedValue({
      clientRef,
      grantCode: code,
      phase: "PRE_AWARD",
      stage: "AWARD",
      status: "APPROVED",
    });

    const result = await server.inject({
      method: "GET",
      url: `/grants/${code}/applications/${clientRef}/status`,
    });

    expect(result.statusCode).toEqual(200);
    expect(getApplicationStatusUseCase).toHaveBeenCalledWith({
      code,
      clientRef,
    });
    expect(result.result).toEqual({
      clientRef,
      grantCode: code,
      phase: "PRE_AWARD",
      stage: "AWARD",
      status: "APPROVED",
    });
  });
});
