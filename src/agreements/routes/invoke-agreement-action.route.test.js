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
  "x-agreement-source": "defra",
  "x-agreement-code": "pigs-might-fly",
  "x-agreement-sbi": "300000000",
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
      access: {
        source: "defra",
        code: "pigs-might-fly",
        sbi: "300000000",
      },
    });
  });

  it("returns a render-ready validation page as 422", async () => {
    const validationPage = {
      agreement: {
        agreementNumber: "PMF123",
        code: "pigs-might-fly",
        clientRef: "client",
        identifiers: { sbi: "300000000" },
        state: "offered",
        version: 1,
      },
      page: { name: "accept", title: "Accept" },
      components: [
        {
          component: "checkboxes",
          name: "confirmation",
          errorMessage: { text: "Confirm" },
          items: [{ value: "confirmed", checked: false }],
        },
      ],
      actions: [],
      values: {},
      errors: [{ href: "#confirmation", text: "Confirm" }],
      etag: '"PMF123:1:1.2.0"',
    };
    executeAgreementActionUseCase.mockResolvedValue(validationPage);

    const response = await server.inject({
      method: "POST",
      url,
      headers,
      payload: { values: {} },
    });

    expect(response.statusCode).toBe(422);
    expect(response.headers.etag).toBe('"PMF123:1:1.2.0"');
    const { etag, ...responsePage } = validationPage;
    expect(response.result).toEqual(responsePage);
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
