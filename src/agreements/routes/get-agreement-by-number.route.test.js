import hapi from "@hapi/hapi";
import { expect, it, vi } from "vitest";
import { getCurrentAgreementPageModelUseCase } from "../use-cases/get-current-agreement-page-model.use-case.js";
import { getAgreementByNumberRoute } from "./get-agreement-by-number.route.js";

vi.mock("../use-cases/get-current-agreement-page-model.use-case.js");

it("returns canonical Agreement presentation with an ETag", async () => {
  const server = hapi.server();
  server.route(getAgreementByNumberRoute);
  const agreement = { agreementNumber: "PMF123", version: 2 };
  const pageModel = {
    agreement: {
      agreementNumber: "PMF123",
      code: "pigs-might-fly",
      clientRef: "client",
      identifiers: { sbi: "300000000" },
      state: "offered",
      version: 2,
    },
    page: { name: "offer", title: "Offer" },
    components: [],
    actions: [],
  };
  getCurrentAgreementPageModelUseCase.mockResolvedValue({
    agreement,
    pageModel,
  });

  const response = await server.inject("/agreements/PMF123");

  expect(response.statusCode).toBe(200);
  expect(response.headers.etag).toBe('"PMF123:2"');
  expect(response.result).toEqual(pageModel);
});
