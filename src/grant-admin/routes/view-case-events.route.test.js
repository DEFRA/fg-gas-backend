import hapi from "@hapi/hapi";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { viewCasePageUseCase } from "../use-cases/view-case-page.use-case.js";
import { viewCaseEventsRoute } from "./view-case-events.route.js";

vi.mock("../../common/logger.js");
vi.mock("../use-cases/view-case-page.use-case.js");

const OID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const HEADERS = { "x-actor": "Jo Operator", "x-actor-id": OID };

const CASE_HEADER = {
  caseRef: "ref-1",
  workflowCode: "frps-private-beta",
  position: { phase: null, stage: null, status: null },
  closed: false,
  closedAt: null,
  counterpart: { exists: true },
  fetchedAt: "2026-06-16T10:00:00.000Z",
};

const PAGE = {
  header: CASE_HEADER,
  events: { rows: [], more: false },
  sourceErrors: [],
  sectionErrors: [],
};

describe("viewCaseEventsRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.ext("onRequest", (request, h) => {
      request.auth.credentials = { service: "fg-grants-platform-admin" };
      return h.continue;
    });
    server.route(viewCaseEventsRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  const get = (headers = HEADERS) =>
    server.inject({
      method: "GET",
      url: "/grant-admin/workflows/frps-private-beta/cases/ref-1/events",
      headers,
    });

  it("answers the events page, passing the encoded operator name to Caseworking's read", async () => {
    viewCasePageUseCase.mockResolvedValue(PAGE);

    const response = await get();

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(viewCasePageUseCase).toHaveBeenCalledWith({
      workflowCode: "frps-private-beta",
      caseRef: "ref-1",
      tab: "events",
      caller: "fg-grants-platform-admin",
      actor: "Jo Operator",
    });
  });
});
