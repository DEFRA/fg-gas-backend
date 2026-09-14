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
import { eventDetailPageUseCase } from "../use-cases/event-detail-page.use-case.js";
import { getEventRoute } from "./get-event.route.js";

vi.mock("../../common/logger.js");
vi.mock("../use-cases/event-detail-page.use-case.js");

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

  it("declares the composed detail page response schema", () => {
    expect(getEventRoute.options.response.schema.describe().flags.label).toBe(
      "EventDetailPage",
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
    const detail = { id: ID, journey: [], sectionErrors: [] };
    eventDetailPageUseCase.mockResolvedValue(detail);

    const result = await getEventRoute.handler(aRequest());

    expect(eventDetailPageUseCase).toHaveBeenCalledWith({
      service: "gas",
      box: "inbox",
      id: ID,
      caller: "grants-ui",
    });
    expect(result).toBe(detail);
  });

  it("sends a null caller when there are no credentials", async () => {
    eventDetailPageUseCase.mockResolvedValue({ id: ID });

    await getEventRoute.handler(aRequest({ auth: undefined }));

    expect(eventDetailPageUseCase).toHaveBeenCalledWith(
      expect.objectContaining({ caller: null }),
    );
  });
});

describe("getEventRoute over HTTP", () => {
  let server;

  // An OUTBOX detail, which is why it carries no reference, traceparent or
  // trace id.
  const detail = {
    service: "gas",
    box: "outbox",
    id: ID,
    eventId: "evt-detail-1",
    type: "case.create",
    hop: "GAS Outbox",
    queue: "to Caseworking",
    queueValue: "gas__sns__create_new_case_fifo.fifo",
    status: "DEAD_LETTER",
    statusLabel: "Dead letter",
    statusRole: "error",
    statusRetrying: false,
    attempts: "5/5",
    showAttempts: true,
    createdAt: "2026-06-16T10:00:00.000Z",
    lastFailureAt: null,
    lastError: null,
    payload: { id: "evt-detail-1", data: { clientRef: "REF-1" } },
    typeTitle: "cloud.defra.local.fg-gas-backend.case.create",
    occurredAt: "2026-06-16T10:00:00.000Z",
    messageGroupId: null,
    publicationDate: "2026-06-16T10:00:00.000Z",
    completionDate: null,
    lastResubmissionDate: null,
    claimedAt: null,
    claimExpiresAt: null,
    attemptHistory: [],
    lastRedrive: null,
  };

  // The hops the journey table draws - not list rows.
  const hop = {
    service: "gas",
    box: "inbox",
    id: "665f1c2e9a1b2c3d4e5f6a7c",
    hop: "GAS Inbox",
    status: "COMPLETED",
    statusLabel: "Completed",
    statusRole: "success",
    statusRetrying: false,
    startedAt: "2026-06-16T10:00:01.000Z",
    took: "1.2s",
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
    eventDetailPageUseCase.mockResolvedValue({
      ...detail,
      journey: [hop],
      journeyTruncated: false,
      sectionErrors: [],
    });
  });

  it("answers with the detail and its journey", async () => {
    const result = await server.inject({ method: "GET", url });

    expect(result.statusCode).toEqual(200);
    expect(result.result.journey).toEqual([hop]);
    expect(result.result.sectionErrors).toEqual([]);
    expect(result.result.payload).toEqual(detail.payload);
  });

  it("answers 200 with a null journey and its sectionError", async () => {
    eventDetailPageUseCase.mockResolvedValue({
      ...detail,
      journey: null,
      journeyTruncated: false,
      sectionErrors: [{ section: "journey", message: "read failed" }],
    });

    const result = await server.inject({ method: "GET", url });

    expect(result.statusCode).toEqual(200);
    expect(result.result.journey).toBeNull();
    expect(result.result.sectionErrors).toEqual([
      { section: "journey", message: "read failed" },
    ]);
  });

  it("answers 404 when the event is not found", async () => {
    eventDetailPageUseCase.mockRejectedValue(
      Boom.notFound(`gas outbox event "${ID}" not found`),
    );

    const result = await server.inject({ method: "GET", url });

    expect(result.statusCode).toEqual(404);
    expect(result.result.message).toEqual(`gas outbox event "${ID}" not found`);
  });

  it("answers 502 when the event could not be read", async () => {
    eventDetailPageUseCase.mockRejectedValue(
      Boom.badGateway("Caseworking outbox unavailable"),
    );

    const result = await server.inject({ method: "GET", url });

    expect(result.statusCode).toEqual(502);
  });

  it("answers 500 when a journey hop carries a detail-only field", async () => {
    eventDetailPageUseCase.mockResolvedValue({
      ...detail,
      journey: [{ ...hop, payload: { leaked: true } }],
      journeyTruncated: false,
      sectionErrors: [],
    });

    const result = await server.inject({ method: "GET", url });

    expect(result.statusCode).toEqual(500);
  });

  it("answers 400 for an id that is not a 24-hex ObjectId", async () => {
    const result = await server.inject({
      method: "GET",
      url: "/grant-admin/events/gas/outbox/nope",
    });

    expect(result.statusCode).toEqual(400);
    expect(eventDetailPageUseCase).not.toHaveBeenCalled();
  });
});
