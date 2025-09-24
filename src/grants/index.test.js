import hapi from "@hapi/hapi";
import { up } from "migrate-mongo";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../common/logger.js";
import { db, mongoClient } from "../common/mongo-client.js";
import { grants } from "./index.js";
import { agreementStatusUpdatedSubscriber } from "./subscribers/agreement-status-updated.subscriber.js";
import { caseStatusUpdatedSubscriber } from "./subscribers/case-status-updated.subscriber.js";

vi.mock("../common/logger.js");
vi.mock("../common/mongo-client.js");
vi.mock("migrate-mongo");
vi.mock("./subscribers/agreement-status-updated.subscriber.js");
vi.mock("./subscribers/case-status-updated.subscriber.js");

describe("grants", () => {
  let server;

  beforeEach(() => {
    server = hapi.server();
    up.mockResolvedValue([]);
  });

  it("runs migrations on startup", async () => {
    await server.register(grants);
    await server.initialize();

    expect(up).toHaveBeenCalledWith(db, mongoClient);
  });

  it("logs applied migrations", async () => {
    up.mockResolvedValue(["001-initial-migration.js", "002-add-some-data.js"]);

    await server.register(grants);
    await server.initialize();

    expect(logger.info).toHaveBeenCalledWith("Running migrations");
    expect(logger.info).toHaveBeenCalledWith(
      "Migrated: 001-initial-migration.js",
    );
    expect(logger.info).toHaveBeenCalledWith("Migrated: 002-add-some-data.js");
    expect(logger.info).toHaveBeenCalledWith("Finished running migrations");
  });

  it("starts subscribers on startup", async () => {
    await server.register(grants);
    await server.initialize();

    server.events.emit("start");

    expect(agreementStatusUpdatedSubscriber.start).toHaveBeenCalled();
    expect(caseStatusUpdatedSubscriber.start).toHaveBeenCalled();
  });

  it("stops subscribers on stop", async () => {
    await server.register(grants);
    await server.initialize();

    server.events.emit("stop");

    expect(agreementStatusUpdatedSubscriber.stop).toHaveBeenCalled();
    expect(caseStatusUpdatedSubscriber.stop).toHaveBeenCalled();
  });

  it("registers routes", async () => {
    await server.register(grants);
    await server.initialize();

    const routePaths = server.table().map((r) => ({
      path: r.path,
      method: r.method,
    }));

    expect(routePaths).toEqual([
      { method: "post", path: "/grants" },
      { method: "post", path: "/grants/{code}/applications" },
      { method: "post", path: "/grants/{code}/actions/{name}/invoke" },
      { method: "put", path: "/tmp/grants/{code}" },
      { method: "get", path: "/grants" },
      { method: "get", path: "/grants/{code}" },
      { method: "get", path: "/grants/{code}/applications/{clientRef}/status" },
      { method: "get", path: "/grants/{code}/actions/{name}/invoke" },
    ]);
  });
});
