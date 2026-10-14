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
import { getGrantAllowList } from "../../grants/services/allow-list.service.js";
import { getAllowListRoute } from "./get-allow-list.route.js";

vi.mock("../../common/logger.js");
vi.mock("../../grants/services/allow-list.service.js");

const ACTOR_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const HEADERS = { "x-actor": "Jo Operator", "x-actor-id": ACTOR_ID };
const ALLOW_LIST = {
  grantCode: "woodland",
  global: { sbi: ["106000033"], crn: ["1042000000"] },
};
const VIEW = {
  sbi: {
    key: "sbi",
    label: "Single Business Identifiers (SBIs)",
    value: "106000033",
    hint: "One per line. 1 listed.",
  },
  crn: {
    key: "crn",
    label: "Customer Reference Numbers (CRNs)",
    value: "1042000000",
    hint: "One per line. 1 listed.",
  },
  errorSummary: [],
};

describe("getAllowListRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.ext("onRequest", (request, h) => {
      request.auth.credentials = { service: "fg-grants-platform-admin" };
      return h.continue;
    });
    server.route(getAllowListRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    getGrantAllowList.mockResolvedValue(ALLOW_LIST);
  });

  const get = (headers = HEADERS) =>
    server.inject({
      method: "GET",
      url: "/grant-admin/grants/woodland/allow-list",
      headers,
    });

  it("is a GET on the grant allow-list path", () => {
    expect(getAllowListRoute.method).toBe("GET");
    expect(getAllowListRoute.path).toBe(
      "/grant-admin/grants/{code}/allow-list",
    );
  });

  it("returns the allow-list view without caching it", async () => {
    const response = await get();

    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual(VIEW);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(getGrantAllowList).toHaveBeenCalledWith({
      grantCode: "woodland",
      caller: "fg-grants-platform-admin",
      userRoles: [],
    });
  });

  it("forwards the operator's caseworking roles for grant admin enforcement", async () => {
    const response = await get({
      ...HEADERS,
      "x-user-roles": "OTHER, ROLE_WOODLAND_ADMIN",
    });
    expect(response.statusCode).toBe(200);
    expect(getGrantAllowList).toHaveBeenCalledWith({
      grantCode: "woodland",
      caller: "fg-grants-platform-admin",
      userRoles: ["OTHER", "ROLE_WOODLAND_ADMIN"],
    });
  });

  it.each([
    ["x-actor", { "x-actor-id": ACTOR_ID }],
    ["x-actor-id", { "x-actor": "Jo Operator" }],
  ])("requires the %s operator header", async (_, headers) => {
    expect((await get(headers)).statusCode).toBe(400);
    expect(getGrantAllowList).not.toHaveBeenCalled();
  });

  it("propagates an unknown grant as 404", async () => {
    getGrantAllowList.mockRejectedValue(Boom.notFound("missing"));

    expect((await get()).statusCode).toBe(404);
  });

  it("propagates an unexpected failure as 500", async () => {
    getGrantAllowList.mockRejectedValue(new Error("database failed"));

    expect((await get()).statusCode).toBe(500);
  });
});
