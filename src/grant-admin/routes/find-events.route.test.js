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
import { findEventsUseCase } from "../use-cases/find-events.use-case.js";
import { findEventsRoute } from "./find-events.route.js";

vi.mock("../use-cases/find-events.use-case.js");
vi.mock("../../common/logger.js");

const event = {
  service: "gas",
  box: "outbox",
  id: "665f1c2e9a1b2c3d4e5f6a7b",
  eventId: "3f2c1a0e-0000-4000-8000-000000000000",
  type: "case.status.updated",
  fullType: "cloud.defra.prd.fg-gas-backend.case.update.status",
  source: null,
  target: "cw__sns__update_status_fifo",
  segregationRef: "GLD-9B2-BWS-grasslands",
  status: "DEAD_LETTER",
  attempts: 5,
  maxAttempts: 5,
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  createdAt: "2026-06-16T10:00:00.000Z",
  lastFailureAt: "2026-06-16T10:16:05.000Z",
  completedAt: null,
};

const emptyPage = {
  events: [],
  pagination: {
    startCursor: null,
    endCursor: null,
    hasNextPage: false,
    hasPreviousPage: false,
  },
  sourceErrors: [],
};

const page = (overrides = {}) => ({ ...emptyPage, ...overrides });

describe("findEventsRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.route(findEventsRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    findEventsUseCase.mockResolvedValue(page());
  });

  it("returns the use case's page as the response body", async () => {
    findEventsUseCase.mockResolvedValue(
      page({
        events: [event],
        pagination: {
          startCursor: "start",
          endCursor: "end",
          hasNextPage: true,
          hasPreviousPage: false,
        },
        sourceErrors: [
          { service: "caseworking", box: "inbox", message: "timeout" },
        ],
      }),
    );

    const result = await server.inject({
      method: "GET",
      url: "/grant-admin/events",
    });

    expect(result.statusCode).toEqual(200);
    expect(result.result.events).toEqual([event]);
    expect(result.result.sourceErrors).toEqual([
      { service: "caseworking", box: "inbox", message: "timeout" },
    ]);
  });

  it("defaults direction to forward", async () => {
    await server.inject({ method: "GET", url: "/grant-admin/events" });

    expect(findEventsUseCase).toHaveBeenCalledWith({
      cursor: undefined,
      direction: "forward",
      status: undefined,
      service: undefined,
    });
  });

  it("forwards cursor, direction, status and service to the use case", async () => {
    await server.inject({
      method: "GET",
      url: "/grant-admin/events?cursor=abc&direction=backward&status=FAILED&service=caseworking",
    });

    expect(findEventsUseCase).toHaveBeenCalledWith({
      cursor: "abc",
      direction: "backward",
      status: "FAILED",
      service: "caseworking",
    });
  });

  it.each([
    ["status=BOGUS", "/grant-admin/events?status=BOGUS"],
    ["service=other", "/grant-admin/events?service=other"],
    ["direction=sideways", "/grant-admin/events?direction=sideways"],
    ["an unknown query parameter", "/grant-admin/events?pageSize=50"],
  ])("responds 400 for %s", async (_name, url) => {
    const result = await server.inject({ method: "GET", url });

    expect(result.statusCode).toEqual(400);
    expect(findEventsUseCase).not.toHaveBeenCalled();
  });

  it("responds 400 with Cannot decode cursor when the use case throws that Boom", async () => {
    findEventsUseCase.mockRejectedValue(
      Boom.badRequest("Cannot decode cursor"),
    );

    const result = await server.inject({
      method: "GET",
      url: "/grant-admin/events?cursor=tampered",
    });

    expect(result.statusCode).toEqual(400);
    expect(result.result.message).toEqual("Cannot decode cursor");
  });

  it("responds 502 when the use case throws Boom.badGateway", async () => {
    findEventsUseCase.mockRejectedValue(
      Boom.badGateway("Events could not be loaded from GAS"),
    );

    const result = await server.inject({
      method: "GET",
      url: "/grant-admin/events",
    });

    expect(result.statusCode).toEqual(502);
  });

  it("responds 200 for a row whose status is outside the six documented values", async () => {
    findEventsUseCase.mockResolvedValue(
      page({ events: [{ ...event, status: "SOMETHING_ELSE" }] }),
    );

    const result = await server.inject({
      method: "GET",
      url: "/grant-admin/events",
    });

    expect(result.statusCode).toEqual(200);
    expect(result.result.events[0].status).toEqual("SOMETHING_ELSE");
  });

  it("responds 500 when the use case returns a row carrying an extra key", async () => {
    findEventsUseCase.mockResolvedValue(
      page({
        events: [{ ...event, event: { data: { clientRef: "secret" } } }],
      }),
    );

    const result = await server.inject({
      method: "GET",
      url: "/grant-admin/events",
    });

    expect(result.statusCode).toEqual(500);
  });

  it("returns an empty page with null cursors and no pager flags", async () => {
    const result = await server.inject({
      method: "GET",
      url: "/grant-admin/events",
    });

    expect(result.statusCode).toEqual(200);
    expect(result.result).toEqual(emptyPage);
  });
});
