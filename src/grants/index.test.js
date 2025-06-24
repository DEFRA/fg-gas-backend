import hapi from "@hapi/hapi";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../common/mongo-client.js";
import { grants } from "./index.js";
import { caseStageUpdatedSubscriber } from "./subscribers/case-stage-updated.subscriber.js";

vi.mock("../common/mongo-client.js");

vi.mock("./subscribers/case-stage-updated.subscriber.js");

describe("grants", () => {
  let server;

  beforeEach(() => {
    server = hapi.server();
  });

  it("creates indexes on startup", async () => {
    await server.register(grants);
    await server.initialize();

    expect(db.createIndex).toHaveBeenCalledWith(
      "grants",
      { code: 1 },
      { unique: true },
    );
    expect(db.createIndex).toHaveBeenCalledWith(
      "applications",
      { clientRef: 1 },
      { unique: true },
    );
  });

  it("starts subscribers on startup", async () => {
    await server.register(grants);
    await server.initialize();

    server.events.emit("start");

    expect(caseStageUpdatedSubscriber.start).toHaveBeenCalled();
  });

  it("stops subscribers on stop", async () => {
    await server.register(grants);
    await server.initialize();

    server.events.emit("stop");

    expect(caseStageUpdatedSubscriber.stop).toHaveBeenCalled();
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
      { method: "get", path: "/grants/{code}/actions/{name}/invoke" },
    ]);
  });
});
