import hapi from "@hapi/hapi";
import { beforeEach, expect, it, vi } from "vitest";
import { getAgreementDocumentPageModelUseCase } from "../use-cases/get-agreement-document-page-model.use-case.js";
import { getAgreementByNumberRoute } from "./get-agreement-by-number.route.js";

vi.mock("../use-cases/get-agreement-document-page-model.use-case.js");

beforeEach(() => {
  vi.clearAllMocks();
});

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
    page: { name: "document", title: "Document" },
    components: [],
    actions: [],
  };
  getAgreementDocumentPageModelUseCase.mockResolvedValue({
    agreement,
    pageModel,
  });

  const response = await server.inject({
    url: "/agreements/PMF123/document",
    headers: {
      "x-agreement-source": "defra",
      "x-agreement-code": "pigs-might-fly",
      "x-agreement-sbi": "300000000",
    },
  });

  expect(response.statusCode).toBe(200);
  expect(response.headers.etag).toBe('"PMF123:2"');
  expect(response.result).toEqual(pageModel);
  expect(getAgreementDocumentPageModelUseCase).toHaveBeenCalledWith({
    agreementNumber: "PMF123",
    access: {
      source: "defra",
      code: "pigs-might-fly",
      sbi: "300000000",
    },
  });
});

it("requires trusted Agreement access headers", async () => {
  const server = hapi.server();
  server.route(getAgreementByNumberRoute);

  const response = await server.inject("/agreements/PMF123/document");

  expect(response.statusCode).toBe(400);
  expect(getAgreementDocumentPageModelUseCase).not.toHaveBeenCalled();
});

it("requires Caseworking to provide an SBI", async () => {
  const server = hapi.server();
  server.route(getAgreementByNumberRoute);

  const response = await server.inject({
    url: "/agreements/PMF123/document",
    headers: {
      "x-agreement-source": "entra",
      "x-agreement-code": "pigs-might-fly",
    },
  });

  expect(response.statusCode).toBe(400);
  expect(getAgreementDocumentPageModelUseCase).not.toHaveBeenCalled();
});

it("does not accept presentation modes for the canonical Agreement document", async () => {
  const server = hapi.server();
  server.route(getAgreementByNumberRoute);

  const response = await server.inject(
    "/agreements/PMF123/document?mode=print",
  );

  expect(response.statusCode).toBe(400);
});
