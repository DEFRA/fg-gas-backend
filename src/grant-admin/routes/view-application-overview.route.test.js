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
import { applicationNotFound } from "../services/application-not-found.js";
import { viewApplicationPageUseCase } from "../use-cases/view-application-page.use-case.js";
import { viewApplicationOverviewRoute } from "./view-application-overview.route.js";

vi.mock("../../common/logger.js");
vi.mock("../use-cases/view-application-page.use-case.js");

const OID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const HEADERS = { "x-actor": "Jo Operator", "x-actor-id": OID };

const HEADER = {
  clientRef: "ref-1",
  code: "woodland",
  position: { phase: null, stage: null, status: null },
  counterpart: null,
  fetchedAt: "2026-06-16T10:00:00.000Z",
};

const PAGE = {
  header: HEADER,
  overview: {
    code: "woodland",
    originalConfigVersion: null,
    currentConfigVersion: null,
    submittedAt: null,
    createdAt: null,
    updatedAt: null,
    identifiers: { sbi: null, frn: null, crn: null },
    series: null,
    storedBytes: 10,
  },
  sourceErrors: [],
  sectionErrors: [],
};

describe("viewApplicationOverviewRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.ext("onRequest", (request, h) => {
      request.auth.credentials = { service: "fg-grants-platform-admin" };
      return h.continue;
    });
    server.route(viewApplicationOverviewRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    viewApplicationPageUseCase.mockResolvedValue(PAGE);
  });

  const get = (headers = HEADERS, ref = "ref-1") =>
    server.inject({
      method: "GET",
      url: `/grant-admin/grants/woodland/applications/${ref}/overview`,
      headers,
    });

  it("answers the overview page, never to be stored, in one use-case call", async () => {
    const response = await get();

    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual(PAGE);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(viewApplicationPageUseCase).toHaveBeenCalledWith({
      code: "woodland",
      clientRef: "ref-1",
      tab: "overview",
      caller: "fg-grants-platform-admin",
    });
  });

  it("answers 404 with its reason for an unknown application", async () => {
    viewApplicationPageUseCase.mockRejectedValue(applicationNotFound());

    const response = await get();

    expect(response.statusCode).toBe(404);
    expect(response.result.reason).toBe("APPLICATION_NOT_FOUND");
  });

  it.each([
    ["no x-actor", { "x-actor-id": OID }],
    ["no x-actor-id", { "x-actor": "Jo" }],
  ])("refuses %s with 400", async (_name, headers) => {
    expect((await get(headers)).statusCode).toBe(400);
    expect(viewApplicationPageUseCase).not.toHaveBeenCalled();
  });

  it("refuses a ref outside the clientRef alphabet with 400", async () => {
    expect((await get(HEADERS, "REF_1")).statusCode).toBe(400);
  });
});
