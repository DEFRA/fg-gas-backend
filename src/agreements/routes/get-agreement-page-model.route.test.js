import Boom from "@hapi/boom";
import hapi from "@hapi/hapi";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getAgreementPageModelUseCase } from "../use-cases/get-agreement-page-model.use-case.js";
import { getAgreementPageModelRoute } from "./get-agreement-page-model.route.js";

vi.mock("../use-cases/get-agreement-page-model.use-case.js");

describe("getAgreementPageModelRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.route(getAgreementPageModelRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  it("gets the requested agreement page model", async () => {
    getAgreementPageModelUseCase.mockResolvedValue({
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
      url: "/agreements/render?code=pigs-might-fly&clientRef=xnp-rr3-nfa&sbi=300000069&page=offered",
    });

    expect(getAgreementPageModelUseCase).toHaveBeenCalledWith({
      code: "pigs-might-fly",
      clientRef: "xnp-rr3-nfa",
      sbi: "300000069",
      page: "offered",
      mode: "view",
    });
    expect(statusCode).toEqual(200);
    expect(result).toEqual({
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
  });

  it("defaults mode to view when not supplied", async () => {
    getAgreementPageModelUseCase.mockResolvedValue({
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
      actions: [],
    });

    await server.inject({
      method: "GET",
      url: "/agreements/render?code=pigs-might-fly&clientRef=xnp-rr3-nfa&sbi=300000069&page=offered",
    });

    expect(getAgreementPageModelUseCase).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "view" }),
    );
  });

  it("returns not found when the agreement cannot be resolved", async () => {
    getAgreementPageModelUseCase.mockRejectedValue(
      Boom.notFound("Agreement not found"),
    );

    const { statusCode, result } = await server.inject({
      method: "GET",
      url: "/agreements/render?code=pigs-might-fly&clientRef=xnp-rr3-nfa&sbi=300000069&page=offered",
    });

    expect(statusCode).toEqual(404);
    expect(result).toEqual({
      error: "Not Found",
      message: "Agreement not found",
      statusCode: 404,
    });
  });

  it("surfaces an unsupported mode as a controlled 404 from the use case, not a Joi 400", async () => {
    getAgreementPageModelUseCase.mockRejectedValue(
      Boom.notFound('Unsupported mode "document"'),
    );

    const { statusCode, result } = await server.inject({
      method: "GET",
      url: "/agreements/render?code=pigs-might-fly&clientRef=xnp-rr3-nfa&sbi=300000069&page=offered&mode=document",
    });

    expect(getAgreementPageModelUseCase).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "document" }),
    );
    expect(statusCode).toEqual(404);
    expect(result.message).toBe('Unsupported mode "document"');
  });

  it("surfaces an unsupported page as a controlled 404 from the use case", async () => {
    getAgreementPageModelUseCase.mockRejectedValue(
      Boom.notFound('Unknown page "bogus" for agreement code "pigs-might-fly"'),
    );

    const { statusCode, result } = await server.inject({
      method: "GET",
      url: "/agreements/render?code=pigs-might-fly&clientRef=xnp-rr3-nfa&sbi=300000069&page=bogus",
    });

    expect(statusCode).toEqual(404);
    expect(result.message).toBe(
      'Unknown page "bogus" for agreement code "pigs-might-fly"',
    );
  });

  it("returns a validation error when a required query parameter is missing", async () => {
    const { statusCode, result } = await server.inject({
      method: "GET",
      url: "/agreements/render?code=pigs-might-fly&clientRef=xnp-rr3-nfa&sbi=300000069",
    });

    expect(statusCode).toEqual(400);
    expect(result).toEqual({
      error: "Bad Request",
      message: "Invalid request query input",
      statusCode: 400,
    });
    expect(getAgreementPageModelUseCase).not.toHaveBeenCalled();
  });
});
