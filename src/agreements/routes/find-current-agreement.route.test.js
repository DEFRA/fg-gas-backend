import Boom from "@hapi/boom";
import hapi from "@hapi/hapi";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { findCurrentAgreementUseCase } from "../use-cases/find-current-agreement.use-case.js";
import { findCurrentAgreementRoute } from "./find-current-agreement.route.js";

vi.mock("../use-cases/find-current-agreement.use-case.js");

describe("findCurrentAgreementRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.route(findCurrentAgreementRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  it("finds the current agreement by code, clientRef and sbi", async () => {
    findCurrentAgreementUseCase.mockResolvedValue({
      agreementNumber: "PMF823153883",
      code: "pigs-might-fly",
      clientRef: "xnp-rr3-nfa",
      sbi: "300000069",
      status: "offered",
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

    expect(findCurrentAgreementUseCase).toHaveBeenCalledWith({
      code: "pigs-might-fly",
      clientRef: "xnp-rr3-nfa",
      sbi: "300000069",
    });
    expect(statusCode).toEqual(200);
    expect(result).toEqual({
      agreementNumber: "PMF823153883",
      code: "pigs-might-fly",
      clientRef: "xnp-rr3-nfa",
      sbi: "300000069",
      status: "offered",
      page: {
        name: "offered",
        title: "Review your agreement offer",
        mode: "view",
      },
      components: [],
      actions: [{ text: "Continue", href: "/PMF823153883/accept" }],
    });
  });

  it("returns not found when no Agreement matches the supplied lookup criteria", async () => {
    findCurrentAgreementUseCase.mockRejectedValue(
      Boom.notFound("Agreement not found"),
    );

    const { statusCode, result } = await server.inject({
      method: "GET",
      url: "/agreements/current?code=pigs-might-fly&clientRef=xnp-rr3-nfa&sbi=300000069",
    });

    expect(statusCode).toEqual(404);
    expect(result).toEqual({
      error: "Not Found",
      message: "Agreement not found",
      statusCode: 404,
    });
  });

  it("returns a validation error when a required query parameter is missing", async () => {
    const { statusCode, result } = await server.inject({
      method: "GET",
      url: "/agreements/current?code=pigs-might-fly&clientRef=xnp-rr3-nfa",
    });

    expect(statusCode).toEqual(400);
    expect(result).toEqual({
      error: "Bad Request",
      message: "Invalid request query input",
      statusCode: 400,
    });
    expect(findCurrentAgreementUseCase).not.toHaveBeenCalled();
  });
});
