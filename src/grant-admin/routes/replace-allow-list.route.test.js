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
import { replaceGrantAllowList } from "../../grants/services/allow-list.service.js";
import { replaceAllowListRoute } from "./replace-allow-list.route.js";

vi.mock("../../common/logger.js");
vi.mock("../../grants/services/allow-list.service.js");

const ACTOR_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const HEADERS = { "x-actor": "Jo Operator", "x-actor-id": ACTOR_ID };
const POPULATED = { sbi: "106000033", crn: "1042000000" };

const validationFailure = (details) => {
  const error = Boom.badRequest("The allow list contains invalid entries");
  error.output.payload.errorCode = "ALLOW_LIST_VALIDATION_FAILED";
  error.output.payload.details = details;
  return error;
};

describe("replaceAllowListRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.ext("onRequest", (request, h) => {
      request.auth.credentials = { service: "fg-grants-platform-admin" };
      return h.continue;
    });
    server.route(replaceAllowListRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    replaceGrantAllowList.mockImplementation(({ grantCode, global }) =>
      Promise.resolve({ grantCode, global }),
    );
  });

  const put = (payload = POPULATED, headers = HEADERS) =>
    server.inject({
      method: "PUT",
      url: "/grant-admin/grants/woodland/allow-list",
      headers,
      payload,
    });

  it("is a PUT on the grant allow-list path", () => {
    expect(replaceAllowListRoute.method).toBe("PUT");
    expect(replaceAllowListRoute.path).toBe(
      "/grant-admin/grants/{code}/allow-list",
    );
  });

  it("parses the submitted text and passes both collections to the domain", async () => {
    const response = await put();

    expect(response.statusCode).toBe(200);
    expect(response.result).toMatchObject({
      sbi: { value: "106000033" },
      crn: { value: "1042000000" },
      errorSummary: [],
    });
    expect(replaceGrantAllowList).toHaveBeenCalledWith({
      grantCode: "woodland",
      global: { sbi: ["106000033"], crn: ["1042000000"] },
      caller: "fg-grants-platform-admin",
      userRoles: [],
    });
  });

  it("sends an empty replacement rather than omitting it", async () => {
    const payload = { sbi: "", crn: "" };

    await put(payload);

    expect(replaceGrantAllowList).toHaveBeenCalledWith({
      grantCode: "woodland",
      global: { sbi: [], crn: [] },
      caller: "fg-grants-platform-admin",
      userRoles: [],
    });
  });

  it("drops blank lines before they reach the domain", async () => {
    const payload = { sbi: "106000033\n\n  \n106000044", crn: "" };

    await put(payload);

    expect(replaceGrantAllowList).toHaveBeenCalledWith({
      grantCode: "woodland",
      global: { sbi: ["106000033", "106000044"], crn: [] },
      caller: "fg-grants-platform-admin",
      userRoles: [],
    });
  });

  it.each([
    ["top-level windows", { ...POPULATED, windows: [] }],
    ["missing SBI field", { crn: "1042000000" }],
    ["missing CRN field", { sbi: "106000033" }],
    ["non-string SBI", { sbi: 106000033, crn: "1042000000" }],
  ])("refuses %s before the use case", async (_, payload) => {
    expect((await put(payload)).statusCode).toBe(400);
    expect(replaceGrantAllowList).not.toHaveBeenCalled();
  });

  it.each([
    ["x-actor", { "x-actor-id": ACTOR_ID }],
    ["x-actor-id", { "x-actor": "Jo Operator" }],
  ])("requires the %s operator header", async (_, headers) => {
    expect((await put(POPULATED, headers)).statusCode).toBe(400);
    expect(replaceGrantAllowList).not.toHaveBeenCalled();
  });

  it("returns the shaped view with field errors on a validation failure", async () => {
    const clean = { invalid: [], duplicate: [] };
    replaceGrantAllowList.mockRejectedValue(
      validationFailure({
        sbi: { invalid: ["bad"], duplicate: [] },
        crn: clean,
      }),
    );

    const response = await put({ sbi: "bad", crn: "" });

    expect(response.statusCode).toBe(400);
    expect(response.result).toMatchObject({
      sbi: {
        value: "bad",
        error: 'SBI "bad" on line 1 must be exactly 9 digits',
      },
      errorSummary: [
        {
          text: 'SBI "bad" on line 1 must be exactly 9 digits',
          href: "#sbi",
        },
      ],
    });
  });

  it("propagates any other domain refusal as a plain Boom, unshaped", async () => {
    const error = Boom.badRequest("invalid allow list");
    error.output.payload.errorCode = "SOME_OTHER_ERROR";
    replaceGrantAllowList.mockRejectedValue(error);

    const response = await put();

    expect(response.statusCode).toBe(400);
    expect(response.result.errorCode).toBe("SOME_OTHER_ERROR");
  });

  it("propagates a validation failure with no details as a plain Boom, not an emptily-shaped view", async () => {
    const error = Boom.badRequest(
      "Both SBI and CRN collections must be arrays",
    );
    error.output.payload.errorCode = "ALLOW_LIST_VALIDATION_FAILED";
    replaceGrantAllowList.mockRejectedValue(error);

    const response = await put();

    expect(response.statusCode).toBe(400);
    expect(response.result.errorCode).toBe("ALLOW_LIST_VALIDATION_FAILED");
    expect(response.result.sbi).toBeUndefined();
  });

  it("propagates an unknown grant as 404", async () => {
    replaceGrantAllowList.mockRejectedValue(Boom.notFound("missing"));

    expect((await put()).statusCode).toBe(404);
  });

  it("propagates an unexpected failure as 500", async () => {
    replaceGrantAllowList.mockRejectedValue(new Error("database failed"));

    expect((await put()).statusCode).toBe(500);
  });
});
