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
  hop: "GAS Outbox",
  queue: "to Caseworking",
  queueValue: "gas__sns__update_case_status_fifo.fifo",
  status: "DEAD_LETTER",
  statusLabel: "Dead letter",
  statusRole: "error",
  statusRetrying: false,
  createdAt: "2026-06-16T10:00:00.000Z",
  lastError: null,
  latency: null,
  latencyTitle: "Queued to delivered to SNS",
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

// The use case answers with a fourth key - the journey's shape of the same
// page, which the detail page reads - and this endpoint's schema is closed.
// A fixture without it would let the route return the use case's answer whole
// and never notice that every response fails validation.
const useCasePage = (overrides = {}) => ({
  ...emptyPage,
  hops: [],
  ...overrides,
});

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
    findEventsUseCase.mockResolvedValue(useCasePage());
  });

  // The response schema is closed, so a key the endpoint does not publish is a
  // 500 rather than an oversharing 200 - which is how this was found.
  it("publishes the three keys of a page, and nothing else the use case knows", async () => {
    findEventsUseCase.mockResolvedValue(useCasePage({ events: [event] }));

    const { statusCode, result } = await server.inject({
      method: "GET",
      url: "/grant-admin/events",
    });

    expect(statusCode).toBe(200);
    expect(Object.keys(result).sort()).toEqual([
      "events",
      "pagination",
      "sourceErrors",
    ]);
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
          {
            service: "caseworking",
            box: "inbox",
            hop: "CW Inbox",
            message: "timeout",
          },
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
      {
        service: "caseworking",
        box: "inbox",
        hop: "CW Inbox",
        message: "timeout",
      },
    ]);
  });

  it("defaults direction to forward", async () => {
    await server.inject({ method: "GET", url: "/grant-admin/events" });

    expect(findEventsUseCase).toHaveBeenCalledWith({
      cursor: undefined,
      direction: "forward",
      status: undefined,
      service: undefined,
      audit: "exclude",
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
      audit: "exclude",
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

  it("responds 200 for a row whose status is outside the documented values", async () => {
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

describe("findEventsRoute q", () => {
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
    findEventsUseCase.mockResolvedValue(emptyPage);
  });

  it("forwards q to the use case", async () => {
    await server.inject({
      method: "GET",
      url: "/grant-admin/events?q=GLD-9B2",
    });

    expect(findEventsUseCase).toHaveBeenCalledWith(
      expect.objectContaining({ q: "GLD-9B2" }),
    );
  });

  it("trims q before the use case sees it", async () => {
    await server.inject({
      method: "GET",
      url: "/grant-admin/events?q=%20%20evt-1%20%20",
    });

    expect(findEventsUseCase).toHaveBeenCalledWith(
      expect.objectContaining({ q: "evt-1" }),
    );
  });

  it("treats a whitespace-only q as absent", async () => {
    await server.inject({
      method: "GET",
      url: "/grant-admin/events?q=%20%20",
    });

    expect(findEventsUseCase).toHaveBeenCalledWith(
      expect.objectContaining({ q: undefined }),
    );
  });

  // `kind` is not a known parameter, so it 400s rather than being quietly
  // ignored.
  it.each([
    ["kind=audit", "/grant-admin/events?kind=audit"],
    ["kind=domain", "/grant-admin/events?kind=domain"],
    ["an empty kind", "/grant-admin/events?kind="],
    ["a q over 200 characters", `/grant-admin/events?q=${"a".repeat(201)}`],
  ])("responds 400 for %s", async (_name, url) => {
    const result = await server.inject({ method: "GET", url });

    expect(result.statusCode).toEqual(400);
    expect(findEventsUseCase).not.toHaveBeenCalled();
  });
});

describe("findEventsRoute from and to", () => {
  it("accepts an ISO from and to and rejects from after to", () => {
    const validate = (query) =>
      findEventsRoute.options.validate.query.validate(query);

    expect(
      validate({
        from: "2026-06-16T00:00:00.000Z",
        to: "2026-06-16T23:59:59.999Z",
      }).error,
    ).toBeUndefined();
    expect(
      validate({
        from: "2026-06-16T23:59:59.999Z",
        to: "2026-06-16T00:00:00.000Z",
      }).error,
    ).toBeDefined();
  });

  it("passes from and to to the use case", async () => {
    findEventsUseCase.mockResolvedValue({
      events: [],
      pagination: {},
      sourceErrors: [],
    });

    await findEventsRoute.handler({
      query: {
        direction: "forward",
        from: "2026-06-16T00:00:00.000Z",
        to: "2026-06-16T23:59:59.999Z",
      },
    });

    expect(findEventsUseCase).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "2026-06-16T00:00:00.000Z",
        to: "2026-06-16T23:59:59.999Z",
      }),
    );
  });
});
