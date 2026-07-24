import hapi from "@hapi/hapi";
import { describe, expect, it, vi } from "vitest";
import { getCurrentAgreementPageModelUseCase } from "../use-cases/get-current-agreement-page-model.use-case.js";
import { getCurrentAgreementRoute } from "./get-current-agreement.route.js";

vi.mock("../use-cases/get-current-agreement-page-model.use-case.js");

describe("Current Agreement route", () => {
  it("returns the current page model at the existing external URL", async () => {
    const server = hapi.server();
    server.route(getCurrentAgreementRoute);
    const pageModel = {
      agreement: {
        agreementNumber: "PMF123",
        code: "pigs-might-fly",
        clientRef: "client",
        identifiers: { sbi: "300000000" },
        state: "offered",
        version: 1,
      },
      page: { name: "offered", title: "Review your agreement offer" },
      components: [],
      actions: [],
    };
    getCurrentAgreementPageModelUseCase.mockResolvedValue({
      agreement: { agreementNumber: "PMF123", version: 1 },
      pageModel,
    });

    const response = await server.inject({
      method: "GET",
      url: "/agreements/current?code=pigs-might-fly&clientRef=client&sbi=300000000&mode=print",
    });

    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual(pageModel);
    expect(getCurrentAgreementPageModelUseCase).toHaveBeenCalledWith({
      code: "pigs-might-fly",
      clientRef: "client",
      sbi: "300000000",
      mode: "print",
    });
  });

  it("requires code, client reference and SBI", async () => {
    const server = hapi.server();
    server.route(getCurrentAgreementRoute);

    const response = await server.inject(
      "/agreements/current?code=pigs-might-fly",
    );

    expect(response.statusCode).toBe(400);
  });
});
