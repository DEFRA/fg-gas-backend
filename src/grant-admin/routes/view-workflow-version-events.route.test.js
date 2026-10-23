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
import { viewWorkflowVersionPageUseCase } from "../use-cases/view-workflow-version-page.use-case.js";
import { viewWorkflowVersionEventsRoute } from "./view-workflow-version-events.route.js";

vi.mock("../../common/logger.js");
vi.mock("../use-cases/view-workflow-version-page.use-case.js");

const OID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const HEADERS = { "x-actor": "Jo Operator", "x-actor-id": OID };

const PAGE = {
  header: {
    code: "Woodland",
    version: "1.2.0",
    status: "active",
    receivedAt: "2026-10-01T09:00:00.000Z",
    files: { workflow: { stored: true, fetchStatus: "fetched" } },
    versions: [],
    counterpart: null,
  },
  events: { rows: [], more: false },
  sourceErrors: [{ hop: "CW-BE" }],
  sectionErrors: [],
};

describe("viewWorkflowVersionEventsRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.ext("onRequest", (request, h) => {
      request.auth.credentials = { service: "fg-grants-platform-admin" };
      return h.continue;
    });
    server.route(viewWorkflowVersionEventsRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    viewWorkflowVersionPageUseCase.mockResolvedValue(PAGE);
  });

  it("answers the events page for a mixed-case code, as the operator, in one use-case call", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/grant-admin/workflows/Woodland/versions/1.2.0/events",
      headers: HEADERS,
    });

    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual(PAGE);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(viewWorkflowVersionPageUseCase).toHaveBeenCalledWith({
      code: "Woodland",
      version: "1.2.0",
      tab: "events",
      caller: "fg-grants-platform-admin",
      actor: "Jo Operator",
    });
  });
});
