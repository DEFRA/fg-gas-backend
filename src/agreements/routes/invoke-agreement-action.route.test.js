import Boom from "@hapi/boom";
import hapi from "@hapi/hapi";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeAgreementActionUseCase } from "../use-cases/execute-agreement-action.use-case.js";
import { invokeAgreementActionRoute } from "./invoke-agreement-action.route.js";

vi.mock("../use-cases/execute-agreement-action.use-case.js");

const url = "/agreements/PMF123/actions/accept";
const headers = {
  "if-match": '"PMF123:1"',
  "idempotency-key": "9ea924aa-45e9-43a7-888e-c25054ea658c",
};

describe("invokeAgreementActionRoute", () => {
  let server;
  beforeEach(async () => {
    server = hapi.server();
    server.route(invokeAgreementActionRoute);
    executeAgreementActionUseCase.mockResolvedValue({
      location: "/agreements/PMF123",
    });
  });

  it("executes a number-addressed Agreement action", async () => {
    const response = await server.inject({
      method: "POST",
      url,
      headers,
      payload: { values: { confirm: "confirmed" } },
    });

    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe("/agreements/PMF123");
    expect(executeAgreementActionUseCase).toHaveBeenCalledWith({
      actionName: "accept",
      agreementNumber: "PMF123",
      values: { confirm: "confirmed" },
      ifMatch: '"PMF123:1"',
      idempotencyKey: headers["idempotency-key"],
    });
  });

  it("returns configured validation as 422", async () => {
    executeAgreementActionUseCase.mockResolvedValue({
      agreement: {
        agreementNumber: "PMF123",
        code: "pigs-might-fly",
        clientRef: "client",
        identifiers: { sbi: "300000000" },
        state: "offered",
        version: 1,
      },
      page: { name: "accept", title: "Accept" },
      components: [],
      actions: [],
      values: {},
      errors: [{ name: "confirm", href: "#confirm", message: "Confirm" }],
    });
    const response = await server.inject({
      method: "POST",
      url,
      headers,
      payload: { values: {} },
    });
    expect(response.statusCode).toBe(422);
  });

  it("passes action conflicts through", async () => {
    executeAgreementActionUseCase.mockRejectedValue(
      Boom.conflict("Unavailable"),
    );
    const response = await server.inject({
      method: "POST",
      url,
      headers,
      payload: { values: {} },
    });
    expect(response.statusCode).toBe(409);
  });
});
