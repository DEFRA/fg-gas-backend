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
import { getEventStatusUseCase } from "../use-cases/get-event-status.use-case.js";
import { getEventStatusRoute } from "./get-event-status.route.js";

vi.mock("../../common/logger.js");
vi.mock("../use-cases/get-event-status.use-case.js");

const ID = "665f1c2e9a1b2c3d4e5f6a7b";

const STATUS = {
  status: "RESUBMITTED",
  statusLabel: "Resubmitted",
  attemptsSinceRedrive: 1,
  maxAttempts: 5,
};

describe("getEventStatusRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.route(getEventStatusRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    getEventStatusUseCase.mockResolvedValue(STATUS);
  });

  it("answers the status and the attempts, never stored", async () => {
    const result = await server.inject(
      `/grant-admin/events/caseworking/outbox/${ID}/status`,
    );

    expect(result.statusCode).toBe(200);
    expect(result.result).toEqual(STATUS);
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(getEventStatusUseCase).toHaveBeenCalledWith({
      service: "caseworking",
      box: "outbox",
      id: ID,
    });
  });

  it("refuses an id that is not a 24-hex ObjectId", async () => {
    const result = await server.inject(
      "/grant-admin/events/gas/inbox/nope/status",
    );

    expect(result.statusCode).toBe(400);
  });

  it("answers 404 for an unknown event", async () => {
    getEventStatusUseCase.mockRejectedValue(Boom.notFound("missing"));

    const result = await server.inject(
      `/grant-admin/events/gas/inbox/${ID}/status`,
    );

    expect(result.statusCode).toBe(404);
  });

  it("never answers more than the status and the counts", async () => {
    getEventStatusUseCase.mockResolvedValue({ ...STATUS, event: { a: 1 } });

    const result = await server.inject(
      `/grant-admin/events/gas/inbox/${ID}/status`,
    );

    expect(result.statusCode).toBe(500);
  });
});
