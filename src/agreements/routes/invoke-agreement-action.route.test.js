import hapi from "@hapi/hapi";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { invokeAgreementActionUseCase } from "../use-cases/invoke-agreement-action.use-case.js";
import { invokeAgreementPostActionRoute } from "./invoke-agreement-action.route.js";

vi.mock("../use-cases/invoke-agreement-action.use-case.js");

let server;

beforeAll(async () => {
  server = hapi.server();
  server.route(invokeAgreementPostActionRoute);
  await server.initialize();
});

afterAll(async () => {
  await server.stop();
});

describe("invokeAgreementPostActionRoute", () => {
  it("accepts an Agreement item and returns accepted", async () => {
    invokeAgreementActionUseCase.mockResolvedValue({
      agreementNumber: "PMF000000001",
      code: "pigs-might-fly",
      clientRef: "PMF-APP-001",
      status: "accepted",
    });

    const { statusCode, result } = await server.inject({
      method: "POST",
      url: "/agreements/PMF000000001/actions/accept",
      payload: {
        code: "pigs-might-fly",
        clientRef: "PMF-APP-001",
        acceptedBy: "applicant",
      },
    });

    expect(statusCode).toBe(200);
    expect(result).toEqual({
      agreementNumber: "PMF000000001",
      code: "pigs-might-fly",
      clientRef: "PMF-APP-001",
      status: "accepted",
    });
    expect(invokeAgreementActionUseCase).toHaveBeenCalledWith({
      actionName: "accept",
      agreementNumber: "PMF000000001",
      payload: {
        code: "pigs-might-fly",
        clientRef: "PMF-APP-001",
        acceptedBy: "applicant",
      },
    });
  });
});
