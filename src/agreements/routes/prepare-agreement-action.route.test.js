import hapi from "@hapi/hapi";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prepareAgreementActionUseCase } from "../use-cases/prepare-agreement-action.use-case.js";
import { prepareAgreementActionRoute } from "./prepare-agreement-action.route.js";

vi.mock("../use-cases/prepare-agreement-action.use-case.js");

describe("prepareAgreementActionRoute", () => {
  let server;
  beforeEach(() => {
    server = hapi.server();
    server.route(prepareAgreementActionRoute);
    prepareAgreementActionUseCase.mockResolvedValue({
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
    });
  });

  it("prepares a number-addressed action with its ETag", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/agreements/PMF123/actions/accept",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"PMF123:1"');
    expect(prepareAgreementActionUseCase).toHaveBeenCalledWith({
      actionName: "accept",
      agreementNumber: "PMF123",
    });
  });
});
