import Boom from "@hapi/boom";
import hapi from "@hapi/hapi";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getCurrentAgreementPageUseCase } from "../use-cases/get-current-agreement-page.use-case.js";
import { getCurrentAgreementRoute } from "./get-current-agreement.route.js";

vi.mock("../use-cases/get-current-agreement-page.use-case.js");

describe("getCurrentAgreementRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.route(getCurrentAgreementRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  it("gets the current agreement by code, clientRef and sbi", async () => {
    getCurrentAgreementPageUseCase.mockResolvedValue({
      agreementNumber: "PMF823153883",
      code: "pigs-might-fly",
      clientRef: "xnp-rr3-nfa",
      sbi: "300000069",
      state: "offered",
      page: {
        name: "offered",
        title: "Review your agreement offer",
        mode: "view",
      },
      components: [],
      actions: [{ text: "Continue", href: "/PMF823153883/accept" }],
    });

    const { statusCode, result } = await server.inject({
      method: "GET",
      url: "/agreements/current?code=pigs-might-fly&clientRef=xnp-rr3-nfa&sbi=300000069",
    });

    expect(getCurrentAgreementPageUseCase).toHaveBeenCalledWith({
      code: "pigs-might-fly",
      clientRef: "xnp-rr3-nfa",
      sbi: "300000069",
    });
    expect(statusCode).toEqual(200);
    expect(result).toMatchObject({
      agreementNumber: "PMF823153883",
      state: "offered",
      page: { name: "offered" },
    });
  });

  it("returns not found when no Agreement matches the supplied identity", async () => {
    getCurrentAgreementPageUseCase.mockRejectedValue(
      Boom.notFound("Agreement not found"),
    );

    const { statusCode, result } = await server.inject({
      method: "GET",
      url: "/agreements/current?code=pigs-might-fly&clientRef=xnp-rr3-nfa&sbi=300000069",
    });

    expect(statusCode).toEqual(404);
    expect(result).toMatchObject({
      message: "Agreement not found",
      statusCode: 404,
    });
  });

  it("returns a validation error when a required query parameter is missing", async () => {
    const { statusCode } = await server.inject({
      method: "GET",
      url: "/agreements/current?code=pigs-might-fly&clientRef=xnp-rr3-nfa",
    });

    expect(statusCode).toEqual(400);
    expect(getCurrentAgreementPageUseCase).not.toHaveBeenCalled();
  });
});
