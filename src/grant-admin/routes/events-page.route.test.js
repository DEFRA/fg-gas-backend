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
import {
  serviceVocabulary,
  statusVocabulary,
} from "../services/event-display.js";
import { eventsPageUseCase } from "../use-cases/events-page.use-case.js";
import { eventsPageRoute } from "./events-page.route.js";

vi.mock("../../common/logger.js");
vi.mock("../use-cases/events-page.use-case.js");

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

const COUNTS = {
  PUBLISHED: 0,
  PROCESSING: 0,
  FAILED: 0,
  RESUBMITTED: 0,
  COMPLETED: 0,
  DEAD_LETTER: 1,
};

// The words the toolbar's chips are drawn in, which ride every page.
const STATUSES = statusVocabulary();
const SERVICES = serviceVocabulary();

const emptyPage = {
  events: [],
  pagination: {
    startCursor: null,
    endCursor: null,
    hasNextPage: false,
    hasPreviousPage: false,
  },
  statuses: STATUSES,
  services: SERVICES,
  counts: COUNTS,
  breakdown: { groups: [], sourceErrors: [] },
  sourceErrors: [],
  sectionErrors: [],
};

const page = (overrides = {}) => ({ ...emptyPage, ...overrides });

describe("eventsPageRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.route(eventsPageRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    eventsPageUseCase.mockResolvedValue(page());
  });

  it("is a GET on /grant-admin/events/page", () => {
    expect(eventsPageRoute.method).toBe("GET");
    expect(eventsPageRoute.path).toBe("/grant-admin/events/page");
  });

  it("is one segment after /events, so it cannot collide with the detail route", () => {
    expect(eventsPageRoute.path.split("/")).toHaveLength(4);
    expect(eventsPageRoute.path).not.toContain("{");
  });

  it("leaves auth to the default service strategy", () => {
    expect(eventsPageRoute.options.auth).toBeUndefined();
  });

  it("declares the composed response schema", () => {
    expect(eventsPageRoute.options.response.schema.describe().flags.label).toBe(
      "EventsPageResponse",
    );
  });

  it("returns the use case's page as the response body", async () => {
    eventsPageUseCase.mockResolvedValue(
      page({
        events: [event],
        breakdown: {
          groups: [
            {
              error: "No handler found",
              type: "case.status.updated",
              count: 1,
              firstAt: "2026-06-16T10:00:00.000Z",
              lastAt: "2026-06-16T10:00:00.000Z",
            },
          ],
          sourceErrors: [],
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
      url: "/grant-admin/events/page",
    });

    expect(result.statusCode).toEqual(200);
    expect(Object.keys(result.result).sort()).toEqual([
      "breakdown",
      "counts",
      "events",
      "pagination",
      "sectionErrors",
      "services",
      "sourceErrors",
      "statuses",
    ]);
    expect(result.result.events).toEqual([event]);
    expect(result.result.counts).toEqual(COUNTS);
    expect(result.result.breakdown.groups).toHaveLength(1);
    expect(result.result.sourceErrors).toEqual([
      {
        service: "caseworking",
        box: "inbox",
        hop: "CW Inbox",
        message: "timeout",
      },
    ]);
  });

  it("defaults direction to forward and forwards every filter", async () => {
    await server.inject({
      method: "GET",
      url: "/grant-admin/events/page",
    });

    expect(eventsPageUseCase).toHaveBeenCalledWith({
      cursor: undefined,
      direction: "forward",
      status: undefined,
      service: undefined,
      q: undefined,
      error: undefined,
      from: undefined,
      to: undefined,
      audit: "exclude",
    });
  });

  it("forwards cursor, direction, status, service, q, error, from and to", async () => {
    await server.inject({
      method: "GET",
      url: "/grant-admin/events/page?cursor=abc&direction=backward&status=FAILED&service=caseworking&q=GLD-9B2&error=boom&from=2026-06-16T00:00:00.000Z&to=2026-06-16T23:59:59.999Z",
    });

    expect(eventsPageUseCase).toHaveBeenCalledWith({
      cursor: "abc",
      direction: "backward",
      status: "FAILED",
      service: "caseworking",
      q: "GLD-9B2",
      error: "boom",
      from: "2026-06-16T00:00:00.000Z",
      to: "2026-06-16T23:59:59.999Z",
      audit: "exclude",
    });
  });

  it.each([
    ["status=BOGUS", "/grant-admin/events/page?status=BOGUS"],
    ["service=other", "/grant-admin/events/page?service=other"],
    ["direction=sideways", "/grant-admin/events/page?direction=sideways"],
    [
      "a reversed range",
      "/grant-admin/events/page?from=2026-06-17&to=2026-06-16",
    ],
    ["an unknown query parameter", "/grant-admin/events/page?pageSize=50"],
    ["kind=audit", "/grant-admin/events/page?kind=audit"],
    [
      "a q over 200 characters",
      `/grant-admin/events/page?q=${"a".repeat(201)}`,
    ],
  ])("responds 400 for %s", async (_name, url) => {
    const result = await server.inject({ method: "GET", url });

    expect(result.statusCode).toEqual(400);
    expect(eventsPageUseCase).not.toHaveBeenCalled();
  });

  it("trims q and treats a whitespace-only q as absent", async () => {
    await server.inject({
      method: "GET",
      url: "/grant-admin/events/page?q=%20%20evt-1%20%20",
    });

    expect(eventsPageUseCase).toHaveBeenCalledWith(
      expect.objectContaining({ q: "evt-1" }),
    );

    await server.inject({
      method: "GET",
      url: "/grant-admin/events/page?q=%20%20",
    });

    expect(eventsPageUseCase).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: undefined }),
    );
  });

  it("responds 200 with a null section and its sectionError", async () => {
    eventsPageUseCase.mockResolvedValue(
      page({
        counts: null,
        sectionErrors: [{ section: "counts", message: "read failed" }],
      }),
    );

    const result = await server.inject({
      method: "GET",
      url: "/grant-admin/events/page",
    });

    expect(result.statusCode).toEqual(200);
    expect(result.result.counts).toBeNull();
    expect(result.result.sectionErrors).toEqual([
      { section: "counts", message: "read failed" },
    ]);
  });

  it("responds 200 with a null breakdown and its sectionError", async () => {
    eventsPageUseCase.mockResolvedValue(
      page({
        breakdown: null,
        sectionErrors: [{ section: "breakdown", message: "read failed" }],
      }),
    );

    const result = await server.inject({
      method: "GET",
      url: "/grant-admin/events/page",
    });

    expect(result.statusCode).toEqual(200);
    expect(result.result.breakdown).toBeNull();
  });

  it("responds 500 for a section name outside the two", async () => {
    eventsPageUseCase.mockResolvedValue(
      page({ sectionErrors: [{ section: "events", message: "read failed" }] }),
    );

    const result = await server.inject({
      method: "GET",
      url: "/grant-admin/events/page",
    });

    expect(result.statusCode).toEqual(500);
  });

  it("responds 500 when a row carries an extra key", async () => {
    eventsPageUseCase.mockResolvedValue(
      page({
        events: [{ ...event, event: { data: { clientRef: "secret" } } }],
      }),
    );

    const result = await server.inject({
      method: "GET",
      url: "/grant-admin/events/page",
    });

    expect(result.statusCode).toEqual(500);
  });

  it("responds 400 with Cannot decode cursor when the use case throws that Boom", async () => {
    eventsPageUseCase.mockRejectedValue(
      Boom.badRequest("Cannot decode cursor"),
    );

    const result = await server.inject({
      method: "GET",
      url: "/grant-admin/events/page?cursor=tampered",
    });

    expect(result.statusCode).toEqual(400);
    expect(result.result.message).toEqual("Cannot decode cursor");
  });

  // The list failing is the page failing - the frontend's "unavailable" state.
  it("responds 502 when the use case throws Boom.badGateway", async () => {
    eventsPageUseCase.mockRejectedValue(
      Boom.badGateway("Events could not be loaded from GAS"),
    );

    const result = await server.inject({
      method: "GET",
      url: "/grant-admin/events/page",
    });

    expect(result.statusCode).toEqual(502);
  });
});
