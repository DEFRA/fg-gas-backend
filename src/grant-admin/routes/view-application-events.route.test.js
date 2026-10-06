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
import { viewApplicationPageUseCase } from "../use-cases/view-application-page.use-case.js";
import { viewApplicationEventsRoute } from "./view-application-events.route.js";

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
  events: { rows: [], more: false },
  sourceErrors: [],
  sectionErrors: [],
};

describe("viewApplicationEventsRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.ext("onRequest", (request, h) => {
      request.auth.credentials = { service: "fg-grants-platform-admin" };
      return h.continue;
    });
    server.route(viewApplicationEventsRoute);
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
      url: `/grant-admin/grants/woodland/applications/${ref}/events`,
      headers,
    });

  it("answers the events page, never to be stored, in one use-case call", async () => {
    const response = await get();

    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual(PAGE);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(viewApplicationPageUseCase).toHaveBeenCalledWith({
      code: "woodland",
      clientRef: "ref-1",
      tab: "events",
      caller: "fg-grants-platform-admin",
    });
  });
});
