import hapi from "@hapi/hapi";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  clearListGroups,
  registerListGroup,
} from "../../common/list-groups/registry.js";
import { eventListGroups } from "../../events/lists/event-list-groups.js";
import { composeListGroups } from "../services/list-groups/catalogue.js";
import { eventEntries } from "../services/list-groups/test-groups.js";
import { readShell } from "../services/shell-cache.js";
import { viewShellRoute } from "./view-shell.route.js";

vi.mock("../../common/logger.js");
vi.mock("../services/shell-cache.js");

const SHELL = {
  catalogue: { buckets: [], sourceErrors: [{ hop: "CW-BE" }] },
};

describe("GET /grant-admin/shell", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.route(viewShellRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  it("answers the catalogue as every tagged answer carries it", async () => {
    readShell.mockResolvedValue(SHELL);

    const response = await server.inject("/grant-admin/shell");

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.result).toEqual({ shell: SHELL });
  });

  it("answers a catalogue holding each service's events as one list", async () => {
    clearListGroups();
    eventListGroups().forEach(registerListGroup);
    const { buckets } = composeListGroups(eventEntries(), { cwRead: true });
    clearListGroups();
    readShell.mockResolvedValue({ catalogue: { buckets, sourceErrors: [] } });

    const response = await server.inject("/grant-admin/shell");

    expect(response.statusCode).toBe(200);
    expect(response.result.shell.catalogue.buckets.map(({ id }) => id)).toEqual(
      ["gas.events", "cw.events"],
    );
  });

  it("answers a null shell when the catalogue cannot be built", async () => {
    readShell.mockResolvedValue(null);

    const response = await server.inject("/grant-admin/shell");

    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual({ shell: null });
  });
});
