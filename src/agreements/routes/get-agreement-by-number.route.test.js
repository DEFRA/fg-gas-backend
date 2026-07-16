import hapi from "@hapi/hapi";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getCurrentAgreementPageModelUseCase } from "../use-cases/get-current-agreement-page-model.use-case.js";
import { getAgreementByNumberRoute } from "./get-agreement-by-number.route.js";

vi.mock("../use-cases/get-current-agreement-page-model.use-case.js");

const pageModel = {
  agreementNumber: "PMF823153883",
  code: "pigs-might-fly",
  clientRef: "xnp-rr3-nfa",
  sbi: "300000069",
  state: "offered",
  page: {
    name: "offered",
    title: "Review your agreement offer",
  },
  components: [],
  actions: [],
};

describe("getAgreementByNumberRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.route(getAgreementByNumberRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  it("gets the current page for a matching Agreement number and identity", async () => {
    getCurrentAgreementPageModelUseCase.mockResolvedValue(pageModel);

    const { statusCode, result } = await server.inject({
      method: "GET",
      url: "/agreements/PMF823153883?code=pigs-might-fly&clientRef=xnp-rr3-nfa&sbi=300000069",
    });

    expect(statusCode).toBe(200);
    expect(result).toEqual(pageModel);
    expect(getCurrentAgreementPageModelUseCase).toHaveBeenCalledWith({
      agreementNumber: "PMF823153883",
      code: "pigs-might-fly",
      clientRef: "xnp-rr3-nfa",
      sbi: "300000069",
      mode: "view",
    });
  });

  it("rejects a missing identity field before loading the Agreement", async () => {
    const { statusCode } = await server.inject({
      method: "GET",
      url: "/agreements/PMF823153883?code=pigs-might-fly&clientRef=xnp-rr3-nfa",
    });

    expect(statusCode).toBe(400);
    expect(getCurrentAgreementPageModelUseCase).not.toHaveBeenCalled();
  });
});
