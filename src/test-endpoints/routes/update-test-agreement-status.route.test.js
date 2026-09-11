import Boom from "@hapi/boom";
import hapi from "@hapi/hapi";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { updateTestAgreementStatusUseCase } from "../use-cases/update-test-agreement-status.use-case.js";
import { updateTestAgreementStatusRoute } from "./update-test-agreement-status.route.js";

vi.mock("../use-cases/update-test-agreement-status.use-case.js");

const agreementNumber = "PMF823153889";

const updatedAgreement = (state) => ({
  agreementNumber,
  code: "pigs-might-fly",
  clientRef: "pmf-test-client",
  state,
  version: 2,
  identifiers: { sbi: "300000071" },
  createdAt: "2026-07-15T12:00:00.000Z",
  updatedAt: "2026-07-16T12:00:00.000Z",
});

describe("updateTestAgreementStatusRoute", () => {
  let server;

  beforeEach(() => {
    server = hapi.server();
    server.settings.routes.validate = {
      options: { abortEarly: false },
      failAction: async (_request, _h, error) => {
        throw error;
      },
    };
    server.route(updateTestAgreementStatusRoute);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  const post = (status, number = agreementNumber) =>
    server.inject({
      method: "POST",
      url: `/api/test/agreements/${number}/status`,
      payload: { status },
    });

  it.each(["withdrawn", "cancelled", "terminated"])(
    "returns 200 with the updated state for %s",
    async (status) => {
      updateTestAgreementStatusUseCase.mockResolvedValue(
        updatedAgreement(status),
      );

      const response = await post(status);

      expect(response.statusCode).toBe(200);
      expect(response.result).toEqual({
        message: "Test agreement status updated",
        agreementData: updatedAgreement(status),
      });
      expect(updateTestAgreementStatusUseCase).toHaveBeenCalledWith({
        agreementNumber,
        status,
      });
    },
  );

  it.each(["accepted", "offered", "rejected", "WITHDRAWN", "withdraw", ""])(
    "returns 400 for the unsupported status %s",
    async (status) => {
      const response = await post(status);

      expect(response.statusCode).toBe(400);
      expect(updateTestAgreementStatusUseCase).not.toHaveBeenCalled();
    },
  );

  it("returns 400 when the status is missing", async () => {
    const response = await server.inject({
      method: "POST",
      url: `/api/test/agreements/${agreementNumber}/status`,
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(updateTestAgreementStatusUseCase).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown Agreement", async () => {
    updateTestAgreementStatusUseCase.mockRejectedValue(
      Boom.notFound("Agreement not found"),
    );

    const response = await post("withdrawn");

    expect(response.statusCode).toBe(404);
  });

  it("returns 409 when the transition is invalid from the current state", async () => {
    updateTestAgreementStatusUseCase.mockRejectedValue(
      new Boom.Boom("cannot transition", { statusCode: 409 }),
    );

    const response = await post("terminated");

    expect(response.statusCode).toBe(409);
  });
});
