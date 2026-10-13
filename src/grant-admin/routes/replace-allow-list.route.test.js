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
const POPULATED = {
  global: { sbi: ["106000033"], crn: ["1042000000"] },
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

  it.each([POPULATED, { global: { sbi: [], crn: [] } }])(
    "passes both complete collections to the use case",
    async (payload) => {
      const response = await put(payload);

      expect(response.statusCode).toBe(200);
      expect(response.result).toEqual({
        grantCode: "woodland",
        global: payload.global,
      });
      expect(replaceGrantAllowList).toHaveBeenCalledWith({
        grantCode: "woodland",
        global: payload.global,
        caller: "fg-grants-platform-admin",
        userRoles: [],
      });
    },
  );

  it("passes exact and whitespace-only blanks to domain normalization", async () => {
    const payload = { global: { sbi: ["", "   "], crn: [""] } };
    replaceGrantAllowList.mockResolvedValue({
      grantCode: "woodland",
      global: { sbi: [], crn: [] },
    });

    const response = await put(payload);

    expect(response.statusCode).toBe(200);
    expect(response.result.global).toEqual({ sbi: [], crn: [] });
    expect(replaceGrantAllowList).toHaveBeenCalledWith({
      grantCode: "woodland",
      global: payload.global,
      caller: "fg-grants-platform-admin",
      userRoles: [],
    });
  });

  it.each([
    ["top-level windows", { ...POPULATED, windows: [] }],
    ["global windows", { global: { ...POPULATED.global, windows: [] } }],
    ["missing SBI collection", { global: { crn: [] } }],
    ["missing CRN collection", { global: { sbi: [] } }],
    ["non-string SBI", { global: { sbi: [106000033], crn: [] } }],
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

  it("propagates domain validation as 400", async () => {
    const error = Boom.badRequest("invalid allow list");
    error.output.payload.errorCode = "DUPLICATE_ALLOW_LIST_IDENTIFIER";
    replaceGrantAllowList.mockRejectedValue(error);

    const response = await put();

    expect(response.statusCode).toBe(400);
    expect(response.result.errorCode).toBe("DUPLICATE_ALLOW_LIST_IDENTIFIER");
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
