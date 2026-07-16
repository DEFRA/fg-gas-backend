import Boom from "@hapi/boom";
import hapi from "@hapi/hapi";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getCurrentAgreementPageModelUseCase } from "../use-cases/get-current-agreement-page-model.use-case.js";
import { getCurrentAgreementRoute } from "./get-current-agreement.route.js";

vi.mock("../use-cases/get-current-agreement-page-model.use-case.js");

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

  it("gets the current agreement page model by code, clientRef and sbi", async () => {
    getCurrentAgreementPageModelUseCase.mockResolvedValue({
      agreementNumber: "PMF823153883",
      code: "pigs-might-fly",
      clientRef: "xnp-rr3-nfa",
      sbi: "300000069",
      state: "offered",
      version: 1,
      page: {
        name: "offered",
        title: "Review your agreement offer",
      },
      components: [],
      actions: [
        {
          name: "accept",
          method: "GET",
          text: "Continue",
          href: "/agreements/PMF823153883/actions/accept",
        },
      ],
    });

    const { statusCode, result } = await server.inject({
      method: "GET",
      url: "/agreements/current?code=pigs-might-fly&clientRef=xnp-rr3-nfa&sbi=300000069",
    });

    expect(getCurrentAgreementPageModelUseCase).toHaveBeenCalledWith({
      code: "pigs-might-fly",
      clientRef: "xnp-rr3-nfa",
      sbi: "300000069",
      mode: "view",
    });
    expect(statusCode).toEqual(200);
    expect(result).toMatchObject({
      agreementNumber: "PMF823153883",
      state: "offered",
      page: { name: "offered" },
    });
  });

  it("passes print mode without allowing the caller to select a page", async () => {
    getCurrentAgreementPageModelUseCase.mockResolvedValue({
      agreementNumber: "PMF823153883",
      code: "pigs-might-fly",
      clientRef: "xnp-rr3-nfa",
      sbi: "300000069",
      state: "offered",
      version: 1,
      page: {
        name: "view",
        title: "Agreement document",
        layout: "document",
      },
      components: [],
      actions: [],
    });

    const { statusCode } = await server.inject({
      method: "GET",
      url: "/agreements/current?code=pigs-might-fly&clientRef=xnp-rr3-nfa&sbi=300000069&mode=print",
    });

    expect(statusCode).toBe(200);
    expect(getCurrentAgreementPageModelUseCase).toHaveBeenCalledWith({
      code: "pigs-might-fly",
      clientRef: "xnp-rr3-nfa",
      sbi: "300000069",
      mode: "print",
    });
  });

  it("rejects an unsupported mode before loading the Agreement", async () => {
    const { statusCode } = await server.inject({
      method: "GET",
      url: "/agreements/current?code=pigs-might-fly&clientRef=xnp-rr3-nfa&sbi=300000069&mode=document",
    });

    expect(statusCode).toBe(400);
    expect(getCurrentAgreementPageModelUseCase).not.toHaveBeenCalled();
  });

  it("returns not found when no Agreement matches the supplied identity", async () => {
    getCurrentAgreementPageModelUseCase.mockRejectedValue(
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
    expect(getCurrentAgreementPageModelUseCase).not.toHaveBeenCalled();
  });
});
