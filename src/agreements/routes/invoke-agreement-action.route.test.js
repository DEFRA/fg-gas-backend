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
import { invokeAgreementActionUseCase } from "../use-cases/invoke-agreement-action.use-case.js";
import { invokeAgreementActionRoute } from "./invoke-agreement-action.route.js";

vi.mock("../use-cases/invoke-agreement-action.use-case.js");

describe("invokeAgreementActionRoute", () => {
  let server;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  beforeAll(async () => {
    server = hapi.server();
    server.route(invokeAgreementActionRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  it("returns the configured transition when action validation succeeds", async () => {
    invokeAgreementActionUseCase.mockResolvedValue({
      valid: true,
      transition: {
        from: "offered",
        action: "accept",
        target: "accepted",
      },
    });

    const { statusCode, result } = await server.inject({
      method: "POST",
      url: "/agreements/PMF823153883/actions/accept",
      payload: {
        code: "pigs-might-fly",
        clientRef: "xnp-rr3-nfa",
        sbi: "300000069",
        confirm: "confirmed",
      },
    });

    expect(statusCode).toBe(200);
    expect(result).toEqual({
      valid: true,
      transition: {
        from: "offered",
        action: "accept",
        target: "accepted",
      },
    });
    expect(invokeAgreementActionUseCase).toHaveBeenCalledWith({
      agreementNumber: "PMF823153883",
      actionName: "accept",
      payload: {
        code: "pigs-might-fly",
        clientRef: "xnp-rr3-nfa",
        sbi: "300000069",
        confirm: "confirmed",
      },
    });
  });

  it("returns the configured page model and exact errors on validation failure", async () => {
    const validationResult = {
      agreementNumber: "PMF823153883",
      code: "pigs-might-fly",
      clientRef: "xnp-rr3-nfa",
      sbi: "300000069",
      status: "offered",
      page: {
        name: "accept",
        title: "Accept your agreement offer",
        mode: "view",
      },
      components: [],
      actions: [],
      errors: [
        {
          name: "confirm",
          href: "#confirm",
          message: "Confirm this agreement offer before accepting it",
        },
      ],
    };
    invokeAgreementActionUseCase.mockResolvedValue(validationResult);

    const { statusCode, result } = await server.inject({
      method: "POST",
      url: "/agreements/PMF823153883/actions/accept",
      payload: {
        code: "pigs-might-fly",
        clientRef: "xnp-rr3-nfa",
        sbi: "300000069",
      },
    });

    expect(statusCode).toBe(200);
    expect(result).toEqual(validationResult);
  });

  it("returns conflict for an invalid lifecycle transition", async () => {
    invokeAgreementActionUseCase.mockRejectedValue(
      Boom.conflict(
        'Cannot perform action "accept" from agreement state "accepted". Available actions: none.',
      ),
    );

    const { statusCode, result } = await server.inject({
      method: "POST",
      url: "/agreements/PMF823153883/actions/accept",
      payload: {
        code: "pigs-might-fly",
        clientRef: "xnp-rr3-nfa",
        sbi: "300000069",
        confirm: "confirmed",
      },
    });

    expect(statusCode).toBe(409);
    expect(result).toEqual({
      statusCode: 409,
      error: "Conflict",
      message:
        'Cannot perform action "accept" from agreement state "accepted". Available actions: none.',
    });
  });

  it.each(["code", "clientRef", "sbi"])(
    "rejects a request without required identity field %s",
    async (field) => {
      const payload = {
        code: "pigs-might-fly",
        clientRef: "xnp-rr3-nfa",
        sbi: "300000069",
        confirm: "confirmed",
      };
      delete payload[field];

      const { statusCode } = await server.inject({
        method: "POST",
        url: "/agreements/PMF823153883/actions/accept",
        payload,
      });

      expect(statusCode).toBe(400);
      expect(invokeAgreementActionUseCase).not.toHaveBeenCalled();
    },
  );
});
