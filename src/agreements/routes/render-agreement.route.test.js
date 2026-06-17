import hapi from "@hapi/hapi";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { renderAgreementUseCase } from "../use-cases/render-agreement.use-case.js";
import { renderAgreementGetRoute } from "./render-agreement.route.js";

vi.mock("../use-cases/render-agreement.use-case.js");

let server;

beforeAll(async () => {
  server = hapi.server();
  server.route(renderAgreementGetRoute);
  await server.initialize();
});

afterAll(async () => {
  await server.stop();
});

describe("renderAgreementGetRoute", () => {
  it("returns a config-driven PMF render model", async () => {
    renderAgreementUseCase.mockResolvedValue({
      source: "config",
      agreement: {
        agreementNumber: "PMF000000001",
        code: "pigs-might-fly",
      },
      page: {
        id: "offered",
        title: "Review your agreement offer",
      },
      components: [
        {
          component: "heading",
          level: 1,
          text: "Review your agreement offer",
        },
      ],
    });

    const { statusCode, result } = await server.inject({
      method: "GET",
      url: "/agreements/PMF000000001",
    });

    expect(statusCode).toBe(200);
    expect(result).toEqual({
      source: "config",
      agreement: {
        agreementNumber: "PMF000000001",
        code: "pigs-might-fly",
      },
      page: {
        id: "offered",
        title: "Review your agreement offer",
      },
      components: [
        {
          component: "heading",
          level: 1,
          text: "Review your agreement offer",
        },
      ],
    });
    expect(renderAgreementUseCase).toHaveBeenCalledWith({
      agreementNumber: "PMF000000001",
      page: undefined,
    });
  });

  it("passes the requested page id to the render use case", async () => {
    renderAgreementUseCase.mockResolvedValue({
      source: "config",
      agreement: {
        agreementNumber: "PMF000000001",
        code: "pigs-might-fly",
      },
      page: {
        id: "accept",
        title: "Accept your agreement offer",
      },
      components: [],
    });

    await server.inject({
      method: "GET",
      url: "/agreements/PMF000000001?page=accept",
    });

    expect(renderAgreementUseCase).toHaveBeenCalledWith({
      agreementNumber: "PMF000000001",
      page: "accept",
    });
  });
});
