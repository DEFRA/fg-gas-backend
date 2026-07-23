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
import { executeAgreementActionUseCase } from "../use-cases/execute-agreement-action.use-case.js";
import { invokeAgreementActionRoute } from "./invoke-agreement-action.route.js";

vi.mock("../use-cases/execute-agreement-action.use-case.js");

const agreementItemId = "29b829c4-4e38-405c-9f00-427ee94120a5";

const headers = {
  "if-match": '"opaque-etag"',
  "idempotency-key": "9ea924aa-45e9-43a7-888e-c25054ea658c",
};

const injectAction = (server, values) =>
  server.inject({
    method: "POST",
    url: `/agreements/PMF823153883/items/${agreementItemId}/actions/accept`,
    headers,
    payload: { values },
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

  it("redirects to the current Agreement after execution", async () => {
    const location =
      "/agreements/PMF823153883?code=pigs-might-fly&clientRef=xnp-rr3-nfa&sbi=300000069";
    executeAgreementActionUseCase.mockResolvedValue({ location });

    const { statusCode, headers: responseHeaders } = await injectAction(
      server,
      { confirm: "confirmed" },
    );

    expect(statusCode).toBe(303);
    expect(responseHeaders.location).toBe(location);
    expect(executeAgreementActionUseCase).toHaveBeenCalledWith({
      actionName: "accept",
      agreementNumber: "PMF823153883",
      agreementItemId,
      values: { confirm: "confirmed" },
      ifMatch: headers["if-match"],
      idempotencyKey: headers["idempotency-key"],
    });
  });

  it("returns the configured page model and exact errors on validation failure", async () => {
    const validationResult = {
      agreementNumber: "PMF823153883",
      code: "pigs-might-fly",
      clientRef: "xnp-rr3-nfa",
      sbi: "300000069",
      state: "offered",
      version: 1,
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
    executeAgreementActionUseCase.mockResolvedValue(validationResult);

    const { statusCode, result } = await injectAction(server, {});

    expect(statusCode).toBe(422);
    expect(result).toEqual(validationResult);
  });

  it("returns conflict for an invalid lifecycle transition", async () => {
    executeAgreementActionUseCase.mockRejectedValue(
      Boom.conflict(
        'Cannot perform action "accept" from agreement state "accepted". Available actions: none.',
      ),
    );

    const { statusCode, result } = await injectAction(server, {
      confirm: "confirmed",
    });

    expect(statusCode).toBe(409);
    expect(result).toEqual({
      statusCode: 409,
      error: "Conflict",
      message:
        'Cannot perform action "accept" from agreement state "accepted". Available actions: none.',
    });
  });

  it.each(["if-match", "idempotency-key"])(
    "rejects a request without %s",
    async (header) => {
      const requestHeaders = { ...headers };
      delete requestHeaders[header];

      const { statusCode } = await server.inject({
        method: "POST",
        url: `/agreements/PMF823153883/items/${agreementItemId}/actions/accept`,
        headers: requestHeaders,
        payload: { values: { confirm: "confirmed" } },
      });

      expect(statusCode).toBe(400);
      expect(executeAgreementActionUseCase).not.toHaveBeenCalled();
    },
  );
});
