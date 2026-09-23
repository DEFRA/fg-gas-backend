import hapi from "@hapi/hapi";
import { up } from "migrate-mongo";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AGREEMENT_STATUS_UPDATED_EVENT_TYPE } from "../agreements/events/agreement-status-updated.event.js";
import { logger } from "../common/logger.js";
import { db, mongoClient } from "../common/mongo-client.js";
import {
  clearEventHandlers,
  dispatchEvent,
} from "../events/services/event-handlers.js";
import {
  CASE_STATUS_UPDATED_EVENT_TYPE,
  CONFIG_VERSION_UPDATED_EVENT_TYPE,
} from "./events/inbound-event-types.js";
import { handleConfigVersionMessage } from "./handlers/handle-config-version-message.js";
import { handleGrantStatusMessage } from "./handlers/handle-grant-status-message.js";
import { grants } from "./index.js";
import { configVersionUpdatedSubscriber } from "./subscribers/config-version-updated.subscriber.js";

vi.mock("../common/logger.js");

vi.mock("../common/mongo-client.js");
vi.mock("migrate-mongo");
vi.mock("./handlers/handle-grant-status-message.js");
vi.mock("./handlers/handle-config-version-message.js");
vi.mock("./subscribers/config-version-updated.subscriber.js");

describe("grants", () => {
  let server;

  beforeEach(() => {
    server = hapi.server();
    up.mockResolvedValue([]);
    vi.clearAllMocks();
    clearEventHandlers();
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

  it("starts the Grants-owned subscriber on startup", async () => {
    await server.register(grants);
    await server.initialize();

    server.events.emit("start");

    expect(configVersionUpdatedSubscriber.start).toHaveBeenCalled();
  });

  it("stops the Grants-owned subscriber on stop", async () => {
    await server.register(grants);
    await server.initialize();

    server.events.emit("stop");

    expect(configVersionUpdatedSubscriber.stop).toHaveBeenCalled();
  });

  it("registers Grants handlers for every exact event type", async () => {
    await server.register(grants);

    const agreementMessage = {
      type: AGREEMENT_STATUS_UPDATED_EVENT_TYPE,
      source: "urn:service:agreement",
    };
    const caseWorkingMessage = {
      type: CASE_STATUS_UPDATED_EVENT_TYPE,
      source: "fg-cw-backend",
    };
    const configBrokerMessage = {
      type: CONFIG_VERSION_UPDATED_EVENT_TYPE,
      source: "config-broker",
    };
    await dispatchEvent(agreementMessage);
    await dispatchEvent(caseWorkingMessage);
    await dispatchEvent(configBrokerMessage);

    expect(handleGrantStatusMessage).toHaveBeenNthCalledWith(1, {
      ...agreementMessage,
      source: "AS",
    });
    expect(handleGrantStatusMessage).toHaveBeenNthCalledWith(2, {
      ...caseWorkingMessage,
      source: "CW",
    });
    expect(handleConfigVersionMessage).toHaveBeenCalledWith(
      configBrokerMessage,
    );
  });

  it("registers routes", async () => {
    await server.register(grants);
    await server.initialize();

    const routePaths = server.table().map((r) => ({
      path: r.path,
      method: r.method,
    }));

    expect(routePaths).toEqual(
      expect.arrayContaining([
        { method: "post", path: "/grants" },
        { method: "post", path: "/grants/{code}/applications" },
        { method: "post", path: "/grants/{code}/actions/{name}/invoke" },
        { method: "put", path: "/tmp/grants/{code}" },
        { method: "get", path: "/grants" },
        { method: "get", path: "/grants/{code}" },
        { method: "get", path: "/grants/{code}/actions/{name}/invoke" },
        {
          method: "get",
          path: "/grants/{code}/applications/{clientRef}/status",
        },
        {
          method: "get",
          path: "/grants/{grantCode}/entitlements/{clientRef}/available-claims",
        },
        {
          method: "post",
          path: "/grants/{grantCode}/applications/{clientRef}/claims",
        },
      ]),
    );
    expect(routePaths).toHaveLength(10);
  });
});
