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
import { getEventUseCase } from "../use-cases/get-event.use-case.js";
import { getEventRoute } from "./get-event.route.js";

vi.mock("../../common/logger.js");
vi.mock("../use-cases/get-event.use-case.js");

const ID = "665f1c2e9a1b2c3d4e5f6a7b";

const validateParams = (params) =>
  getEventRoute.options.validate.params.validate(params);

const aRequest = (overrides = {}) => ({
  params: { service: "gas", box: "inbox", id: ID },
  auth: { credentials: { service: "grants-ui", tokenId: "t-1" } },
  ...overrides,
});

describe("getEventRoute", () => {
  it("is a GET on /grant-admin/events/{service}/{box}/{id}", () => {
    expect(getEventRoute.method).toBe("GET");
    expect(getEventRoute.path).toBe("/grant-admin/events/{service}/{box}/{id}");
  });

  it("takes the default service auth strategy", () => {
    expect(getEventRoute.options.auth).toBeUndefined();
  });

  it("declares the detail response schema - the event is the whole answer", () => {
    expect(getEventRoute.options.response.schema.describe().flags.label).toBe(
      "EventDetail",
    );
  });

  it("accepts both services and both boxes", () => {
    for (const service of ["gas", "caseworking"]) {
      for (const box of ["inbox", "outbox"]) {
        expect(validateParams({ service, box, id: ID }).error).toBeUndefined();
      }
    }
  });

  it("rejects an unknown service", () => {
    expect(
      validateParams({ service: "payments", box: "inbox", id: ID }).error,
    ).toBeDefined();
  });

  it("rejects an unknown box", () => {
    expect(
      validateParams({ service: "gas", box: "deadletter", id: ID }).error,
    ).toBeDefined();
  });

  it("rejects an id that is not a 24-hex ObjectId", () => {
    expect(
      validateParams({ service: "gas", box: "inbox", id: "nope" }).error,
    ).toBeDefined();
  });

  it("passes the params and the authenticated caller to the use case", async () => {
    getEventUseCase.mockResolvedValue({ id: ID });

    const result = await getEventRoute.handler(aRequest());

    expect(getEventUseCase).toHaveBeenCalledWith({
      service: "gas",
      box: "inbox",
      id: ID,
      caller: "grants-ui",
    });
    expect(result).toEqual({ id: ID });
  });

  it("sends a null caller when there are no credentials", async () => {
    getEventUseCase.mockResolvedValue({ id: ID });

    await getEventRoute.handler(aRequest({ auth: undefined }));

    expect(getEventUseCase).toHaveBeenCalledWith(
      expect.objectContaining({ caller: null }),
    );
  });
});

describe("getEventRoute over HTTP", () => {
  let server;

  const detail = {
    service: "gas",
    box: "outbox",
    id: ID,
    eventId: "evt-detail-1",
    type: "case.create",
    targetTopic: "gas__sns__create_new_case_fifo.fifo",
    status: "DEAD_LETTER",
    statusLabel: "Dead letter",
    statusRole: "error",
    statusRetrying: false,
    attempts: "5/5",
    createdAt: "2026-06-16T10:00:00.000Z",
    lastError: null,
    payload: { id: "evt-detail-1", data: { clientRef: "REF-1" } },
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    segregationRef: "GLD-9B2",
    completionDate: null,
    expiresAt: null,
    lastResubmissionDate: null,
    attemptHistory: [],
    lastRedrive: null,
    lastPurge: null,
    purgeDeletionDate: null,
    payloadRevision: 0,
    payloadIsPlainJson: true,
    lastEdit: null,
    originalPayload: null,
  };

  const url = `/grant-admin/events/gas/outbox/${ID}`;

  beforeAll(async () => {
    server = hapi.server();
    server.route(getEventRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    getEventUseCase.mockResolvedValue(detail);
  });

  it("answers with the event", async () => {
    const result = await server.inject({ method: "GET", url });

    expect(result.statusCode).toEqual(200);
    expect(result.result.payload).toEqual(detail.payload);
  });

  it("answers 404 when the event is not found", async () => {
    getEventUseCase.mockRejectedValue(
      Boom.notFound(`gas outbox event "${ID}" not found`),
    );

    const result = await server.inject({ method: "GET", url });

    expect(result.statusCode).toEqual(404);
    expect(result.result.message).toEqual(`gas outbox event "${ID}" not found`);
  });

  it("answers 502 when the event could not be read", async () => {
    getEventUseCase.mockRejectedValue(
      Boom.badGateway("Caseworking outbox unavailable"),
    );

    const result = await server.inject({ method: "GET", url });

    expect(result.statusCode).toEqual(502);
  });

  it("answers 400 for an id that is not a 24-hex ObjectId", async () => {
    const result = await server.inject({
      method: "GET",
      url: "/grant-admin/events/gas/outbox/nope",
    });

    expect(result.statusCode).toEqual(400);
    expect(getEventUseCase).not.toHaveBeenCalled();
  });
});
