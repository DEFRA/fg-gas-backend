import Boom from "@hapi/boom";
import hapi from "@hapi/hapi";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { submitClaimUseCase } from "../use-cases/submit-claim.use-case.js";
import { submitClaimRoute } from "./submit-claim.route.js";

vi.mock("../use-cases/submit-claim.use-case.js");
vi.mock("../../common/logger.js");

const payload = {
  metadata: {
    grantCode: "woodland",
    clientRef: "wmp-6hb-j8e",
    claimCode: "ENT_CS_CAPITAL_PA3",
    clientClaimRef: "WMP-6HB-J8E-C0001",
    sbi: "113593357",
    crn: "1100943757",
    frn: "1100943757",
    configVersion: "1.14.0",
    submittedAt: "2026-08-07T11:16:05.745Z",
  },
  answers: {
    claimAmountPence: 150000,
  },
};

describe("submitClaimRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.route(submitClaimRoute);
    await server.initialize();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await server.stop();
  });

  it("returns 201 with the created claimId", async () => {
    submitClaimUseCase.mockResolvedValue({
      created: true,
      claimId: "64b0c0c0c0c0c0c0c0c0c0c0",
    });

    const { statusCode, result } = await server.inject({
      method: "POST",
      url: "/grants/woodland/applications/wmp-6hb-j8e/claims",
      payload,
    });

    expect(statusCode).toBe(201);
    expect(result).toEqual({ claimId: "64b0c0c0c0c0c0c0c0c0c0c0" });
    expect(submitClaimUseCase).toHaveBeenCalledWith({
      grantCode: "woodland",
      clientRef: "wmp-6hb-j8e",
      payload: {
        ...payload,
        metadata: {
          ...payload.metadata,
          submittedAt: new Date(payload.metadata.submittedAt),
        },
      },
    });
  });

  it("returns 200 with an empty body for an idempotent retry", async () => {
    submitClaimUseCase.mockResolvedValue({ created: false });

    const { statusCode, result } = await server.inject({
      method: "POST",
      url: "/grants/woodland/applications/wmp-6hb-j8e/claims",
      payload,
    });

    expect(statusCode).toBe(200);
    expect(result).toBeNull();
  });

  it("returns 400 for an invalid grantCode path parameter", async () => {
    const { statusCode } = await server.inject({
      method: "POST",
      url: "/grants/INVALID/applications/wmp-6hb-j8e/claims",
      payload,
    });

    expect(statusCode).toBe(400);
    expect(submitClaimUseCase).not.toHaveBeenCalled();
  });

  it("returns 409 when the use case rejects the application state", async () => {
    submitClaimUseCase.mockRejectedValue(
      Boom.conflict(
        "Application is not in a valid state to accept claims for this entitlement.",
      ),
    );

    const { statusCode, result } = await server.inject({
      method: "POST",
      url: "/grants/woodland/applications/wmp-6hb-j8e/claims",
      payload,
    });

    expect(statusCode).toBe(409);
    expect(result.message).toBe(
      "Application is not in a valid state to accept claims for this entitlement.",
    );
  });
});
