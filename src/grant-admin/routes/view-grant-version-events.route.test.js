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
import { viewGrantVersionPageUseCase } from "../use-cases/view-grant-version-page.use-case.js";
import { viewGrantVersionEventsRoute } from "./view-grant-version-events.route.js";

vi.mock("../../common/logger.js");
vi.mock("../use-cases/view-grant-version-page.use-case.js");

const OID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const HEADERS = { "x-actor": "Jo Operator", "x-actor-id": OID };

const PAGE = {
  header: {
    code: "woodland",
    version: "2.0.0",
    status: "draft",
    receivedAt: "2026-10-15T10:04:00.000Z",
    s3Bucket: "config-broker-local",
    files: { grant: { stored: true, fetchStatus: "fetched" } },
    versions: [],
    counterpart: null,
  },
  events: {
    rows: [
      {
        service: "gas",
        box: "inbox",
        id: "6716a9c2e4b0a1f2c3d4e5f6",
        eventId: "7c1e0bd2-5f0a-4c4e-9b1d-0000174876e8",
        type: "ConfigVersionUpdated",
        status: "DEAD_LETTER",
        statusLabel: "Dead letter",
        statusRole: "error",
        statusRetrying: false,
        createdAt: "2026-10-14T09:12:03.000Z",
        latency: null,
        latencyTitle: "Received to completed",
      },
    ],
    more: false,
  },
  sourceErrors: [],
  sectionErrors: [],
};

describe("viewGrantVersionEventsRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.ext("onRequest", (request, h) => {
      request.auth.credentials = { service: "fg-grants-platform-admin" };
      return h.continue;
    });
    server.route(viewGrantVersionEventsRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    viewGrantVersionPageUseCase.mockResolvedValue(PAGE);
  });

  const get = (headers = HEADERS) =>
    server.inject({
      method: "GET",
      url: "/grant-admin/grants/woodland/versions/2.0.0/events",
      headers,
    });

  it("answers the events page, never to be stored, in one use-case call", async () => {
    const response = await get();

    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual(PAGE);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(viewGrantVersionPageUseCase).toHaveBeenCalledWith({
      code: "woodland",
      version: "2.0.0",
      tab: "events",
      caller: "fg-grants-platform-admin",
    });
  });

  it("refuses a request that names no operator with 400", async () => {
    expect((await get({ "x-actor-id": OID })).statusCode).toBe(400);
    expect(viewGrantVersionPageUseCase).not.toHaveBeenCalled();
  });
});
