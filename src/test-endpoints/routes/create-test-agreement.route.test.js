import hapi from "@hapi/hapi";
import Boom from "@hapi/boom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestAgreementRoute } from "./create-test-agreement.route.js";
import { createTestAgreementUseCase } from "../use-cases/create-test-agreement.use-case.js";

vi.mock("../use-cases/create-test-agreement.use-case.js");

const agreement = {
  agreementNumber: "PMF823153889",
  code: "pigs-might-fly",
  clientRef: "pmf-test-client",
  state: "offered",
  version: 1,
  identifiers: { sbi: "300000071" },
  createdAt: "2026-07-15T12:00:00.000Z",
  updatedAt: "2026-07-15T12:00:00.000Z",
};

const payload = {
  code: "pigs-might-fly",
  clientRef: "pmf-test-client",
  currentConfigVersion: "1.0.1",
  identifiers: { sbi: "300000071" },
  answers: { whitePigsCount: 5 },
};

describe("createTestAgreementRoute", () => {
  let server;

  beforeEach(async () => {
    server = hapi.server();
    // Mirrors src/server.js, so Joi failures surface as 400 rather than 500.
    server.settings.routes.validate = {
      options: { abortEarly: false },
      failAction: async (_request, _h, error) => {
        throw error;
      },
    };
    server.route(createTestAgreementRoute);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  const post = (body) =>
    server.inject({
      method: "POST",
      url: "/api/test/agreements",
      payload: body,
    });

  it("returns 201 with the created agreement number", async () => {
    createTestAgreementUseCase.mockResolvedValue(agreement);

    const response = await post(payload);

    expect(response.statusCode).toBe(201);
    expect(response.result).toEqual({
      message: "Test agreement created",
      agreementData: agreement,
    });
    expect(createTestAgreementUseCase).toHaveBeenCalledWith(
      expect.objectContaining({ code: payload.code }),
    );
  });

  it.each([
    ["code", { ...payload, code: undefined }],
    ["clientRef", { ...payload, clientRef: undefined }],
    ["identifiers", { ...payload, identifiers: undefined }],
    ["identifiers.sbi", { ...payload, identifiers: {} }],
    ["currentConfigVersion", { ...payload, currentConfigVersion: undefined }],
  ])("returns 400 when %s is missing", async (_field, body) => {
    const response = await post(body);

    expect(response.statusCode).toBe(400);
    expect(createTestAgreementUseCase).not.toHaveBeenCalled();
  });

  it("defaults answers and metadata so a minimal payload is accepted", async () => {
    createTestAgreementUseCase.mockResolvedValue(agreement);
    const { answers: _answers, ...withoutAnswers } = payload;

    const response = await post(withoutAnswers);

    expect(response.statusCode).toBe(201);
    expect(createTestAgreementUseCase).toHaveBeenCalledWith(
      expect.objectContaining({ answers: {}, metadata: {} }),
    );
  });

  it("surfaces the status code of a rejected creation", async () => {
    createTestAgreementUseCase.mockRejectedValue(
      Boom.badRequest("Grant code is not managed by GAS"),
    );

    const response = await post(payload);

    expect(response.statusCode).toBe(400);
  });
});
