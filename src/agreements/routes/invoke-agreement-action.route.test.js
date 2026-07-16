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
import { validateAgreementActionUseCase } from "../use-cases/validate-agreement-action.use-case.js";
import { invokeAgreementActionRoute } from "./invoke-agreement-action.route.js";

vi.mock("../use-cases/validate-agreement-action.use-case.js");

const createPayload = (values) => ({
  reference: {
    code: "pigs-might-fly",
    clientRef: "xnp-rr3-nfa",
    sbi: "300000069",
  },
  values,
});

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
    validateAgreementActionUseCase.mockResolvedValue({
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
      payload: createPayload({ confirm: "confirmed" }),
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
    expect(validateAgreementActionUseCase).toHaveBeenCalledWith({
      actionName: "accept",
      reference: {
        agreementNumber: "PMF823153883",
        code: "pigs-might-fly",
        clientRef: "xnp-rr3-nfa",
        sbi: "300000069",
      },
      values: { confirm: "confirmed" },
    });
  });

  it("returns the configured page model and exact errors on validation failure", async () => {
    const validationResult = {
      agreementNumber: "PMF823153883",
      code: "pigs-might-fly",
      clientRef: "xnp-rr3-nfa",
      sbi: "300000069",
      state: "offered",
      page: {
        name: "accept",
        title: "Accept your agreement offer",
      },
      components: [],
      actions: [],
      values: {},
      errors: [
        {
          name: "confirm",
          href: "#confirm",
          message: "Confirm this agreement offer before accepting it",
        },
      ],
    };
    validateAgreementActionUseCase.mockResolvedValue(validationResult);

    const { statusCode, result } = await server.inject({
      method: "POST",
      url: "/agreements/PMF823153883/actions/accept",
      payload: createPayload({}),
    });

    expect(statusCode).toBe(422);
    expect(result).toEqual(validationResult);
  });

  it("returns conflict for an invalid lifecycle transition", async () => {
    validateAgreementActionUseCase.mockRejectedValue(
      Boom.conflict(
        'Cannot perform action "accept" from agreement state "accepted". Available actions: none.',
      ),
    );

    const { statusCode, result } = await server.inject({
      method: "POST",
      url: "/agreements/PMF823153883/actions/accept",
      payload: createPayload({ confirm: "confirmed" }),
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
      const payload = createPayload({ confirm: "confirmed" });
      delete payload.reference[field];

      const { statusCode } = await server.inject({
        method: "POST",
        url: "/agreements/PMF823153883/actions/accept",
        payload,
      });

      expect(statusCode).toBe(400);
      expect(validateAgreementActionUseCase).not.toHaveBeenCalled();
    },
  );
});
