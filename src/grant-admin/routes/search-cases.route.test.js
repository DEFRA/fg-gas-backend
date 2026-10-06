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
import { searchCasesUseCase } from "../use-cases/search-cases.use-case.js";
import { searchCasesRoute } from "./search-cases.route.js";

vi.mock("../../common/logger.js");
vi.mock("../use-cases/search-cases.use-case.js");

const OID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const HEADERS = { "x-actor": "UTF-8''%C5%81ukasz", "x-actor-id": OID };
const PAGE = {
  rows: [],
  pagination: { endCursor: null, hasNextPage: false },
  sourceErrors: [],
};

describe("searchCasesRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.ext("onRequest", (request, h) => {
      request.auth.credentials = { service: "fg-grants-platform-admin" };
      return h.continue;
    });
    server.route(searchCasesRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    searchCasesUseCase.mockResolvedValue(PAGE);
  });

  const post = (payload, headers = HEADERS) =>
    server.inject({
      method: "POST",
      url: "/grant-admin/cases/search",
      payload,
      headers,
    });

  it("passes the query, the encoded operator name and the repeat flag on", async () => {
    const response = await post(
      { ref: "REF-1", workflowCode: "woodland" },
      { ...HEADERS, "x-search-repeat": "1" },
    );

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(searchCasesUseCase).toHaveBeenCalledWith({
      ref: "ref-1",
      workflowCode: "woodland",
      caller: "fg-grants-platform-admin",
      actor: "UTF-8''%C5%81ukasz",
      repeat: true,
    });
  });

  it("is not a repeat on a later page, even with the header", async () => {
    await post({ cursor: "abc" }, { ...HEADERS, "x-search-repeat": "1" });

    expect(searchCasesUseCase.mock.calls[0][0].repeat).toBe(false);
  });

  it.each([
    ["no x-actor-id", {}, { "x-actor": "Jo" }],
    ["a ref with a cursor", { ref: "ref-1", cursor: "c" }, HEADERS],
    ["a grant code rather than a workflow code", { code: "woodland" }, HEADERS],
  ])("refuses %s with 400", async (_name, payload, headers) => {
    expect((await post(payload, headers)).statusCode).toBe(400);
    expect(searchCasesUseCase).not.toHaveBeenCalled();
  });
});
