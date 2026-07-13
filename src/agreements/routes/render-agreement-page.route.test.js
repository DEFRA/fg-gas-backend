import Boom from "@hapi/boom";
import hapi from "@hapi/hapi";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { renderAgreementPageUseCase } from "../use-cases/render-agreement-page.use-case.js";
import { renderAgreementPageRoute } from "./render-agreement-page.route.js";

vi.mock("../use-cases/render-agreement-page.use-case.js");

describe("renderAgreementPageRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.route(renderAgreementPageRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  it("renders the requested agreement page", async () => {
    renderAgreementPageUseCase.mockResolvedValue({
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
      url: "/agreements/render?code=pigs-might-fly&clientRef=xnp-rr3-nfa&sbi=300000069&page=offered",
    });

    expect(renderAgreementPageUseCase).toHaveBeenCalledWith({
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

  it("defaults mode to view when not supplied", async () => {
    renderAgreementPageUseCase.mockResolvedValue({
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
      actions: [],
    });

    await server.inject({
      method: "GET",
      url: "/agreements/render?code=pigs-might-fly&clientRef=xnp-rr3-nfa&sbi=300000069&page=offered",
    });

    expect(renderAgreementPageUseCase).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "view" }),
    );
  });

  it("returns not found when the agreement cannot be resolved", async () => {
    renderAgreementPageUseCase.mockRejectedValue(
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
    renderAgreementPageUseCase.mockRejectedValue(
      Boom.notFound('Unsupported mode "document"'),
    );

    const { statusCode, result } = await server.inject({
      method: "GET",
      url: "/agreements/render?code=pigs-might-fly&clientRef=xnp-rr3-nfa&sbi=300000069&page=offered&mode=document",
    });

    expect(renderAgreementPageUseCase).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "document" }),
    );
    expect(statusCode).toEqual(404);
    expect(result.message).toBe('Unsupported mode "document"');
  });

  it("surfaces an unsupported page as a controlled 404 from the use case", async () => {
    renderAgreementPageUseCase.mockRejectedValue(
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
    expect(renderAgreementPageUseCase).not.toHaveBeenCalled();
  });
});
