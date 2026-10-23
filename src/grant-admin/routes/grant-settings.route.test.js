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
import { withRequestContext } from "../../common/get-request-context.js";
import { db, mongoClient } from "../../common/mongo-client.js";
import { writeAuditEvent } from "../../events/write-audit-event.js";
import { ConfigVersion } from "../../grants/models/config-version.js";
import { GrantDocument } from "../../grants/models/grant-document.js";
import { Grant } from "../../grants/models/grant.js";
import { checkGrantAllowListUseCase } from "../../grants/use-cases/check-grant-allow-list.use-case.js";
import { findCwUserRoles } from "../repositories/cw-users.repository.js";
import { setAuditActor } from "../set-audit-actor.js";

vi.mock("../../common/mongo-client.js", () => ({
  db: { collection: vi.fn() },
  mongoClient: { startSession: vi.fn() },
}));
vi.mock("../../events/write-audit-event.js");
vi.mock("../repositories/cw-users.repository.js");

const headers = {
  "x-actor": "Jo Operator",
  "x-actor-id": "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
};
const url = "/grant-admin/grants/woodland/settings";
let server;
let documents;
let lists;
let grant;
let session;
let roles;
const applicant = {
  grantCode: "woodland",
  sbi: "900000002",
  crn: "9000000001",
  caller: "grants-ui",
};

beforeAll(async () => {
  server = hapi.server();
  server.ext("onRequest", (request, h) => {
    request.auth.credentials = { service: "fg-grants-platform-admin" };
    return h.continue;
  });
  server.ext("onPostAuth", setAuditActor);
  const { getGrantSettingsRoute, saveGrantSettingsRoute } =
    await import("./grant-settings.route.js");
  server.route([getGrantSettingsRoute, saveGrantSettingsRoute].filter(Boolean));
  await server.initialize();
});
afterAll(async () => server?.stop());
beforeEach(() => {
  documents = [];
  roles = ["ROLE_WOODLAND_ADMIN"];
  lists = {
    grantCode: "woodland",
    global: { sbi: ["900000002"], crn: ["9000000001"] },
  };
  grant = new GrantDocument(
    new Grant({
      code: "woodland",
      version: "1.0.0",
      metadata: { description: "Woodland", startDate: "2026-01-01" },
      admin: { role: "ROLE_WOODLAND_ADMIN" },
      actions: [],
      phases: [],
    }),
  );
  const version = ConfigVersion.new({
    grantCode: "woodland",
    version: "1.0.0",
    status: "active",
    s3Key: "woodland/1/gas.json",
    s3Bucket: "config",
  });
  version.fetchStatus = "fetched";
  db.collection.mockImplementation(
    (name) =>
      ({
        grants: { findOne: async () => grant },
        config_versions: {
          findOne: async () => (grant ? version.toDocument() : null),
        },
        allow_lists: { findOne: async () => lists },
        grant_settings: {
          findOne: async ({ grantCode }) =>
            documents.find((d) => d.grantCode === grantCode) ?? null,
          updateOne: async ({ grantCode }, update) => {
            const record = documents.find((d) => d.grantCode === grantCode);
            if (record) Object.assign(record, update.$set);
            else documents.push({ grantCode, ...update.$set });
          },
        },
      })[name],
  );
  session = {
    withTransaction: async (callback) => {
      const before = structuredClone(documents);
      try {
        await callback(session);
      } catch (error) {
        documents.splice(0, documents.length, ...before);
        throw error;
      }
    },
    endSession: vi.fn(),
  };
  mongoClient.startSession.mockReturnValue(session);
  writeAuditEvent.mockResolvedValue();
  findCwUserRoles.mockImplementation(async () => ({ roles }));
});
const get = () =>
  withRequestContext({}, () => server.inject({ method: "GET", url, headers }));
const put = (open) =>
  withRequestContext({}, () =>
    server.inject({ method: "PUT", url, headers, payload: { open } }),
  );

describe("grant settings HTTP interface", () => {
  it("reports a grant with no settings as closed without creating a record", async () => {
    const response = await get();
    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual({ grantCode: "woodland", open: false });
    expect(documents).toEqual([]);
    expect(response.headers["cache-control"]).toBe("no-store");
  });
  it("opens the grant on first save and uses the existing identifier rules", async () => {
    expect((await put(true)).statusCode).toBe(200);
    expect((await get()).result).toEqual({ grantCode: "woodland", open: true });
    await expect(checkGrantAllowListUseCase(applicant)).resolves.toEqual({
      allowed: true,
    });
    await expect(
      checkGrantAllowListUseCase({ ...applicant, sbi: "900000004" }),
    ).resolves.toEqual({ allowed: false });
  });

  it("can close and reopen without losing identifier restrictions or changing other grants", async () => {
    documents.push({ grantCode: "other", open: true });
    await put(true);
    await put(false);
    await expect(checkGrantAllowListUseCase(applicant)).resolves.toEqual({
      allowed: false,
    });
    await put(true);
    await expect(checkGrantAllowListUseCase(applicant)).resolves.toEqual({
      allowed: true,
    });
    await expect(
      checkGrantAllowListUseCase({ ...applicant, crn: "9000000003" }),
    ).resolves.toEqual({ allowed: false });
    expect(documents).toEqual([
      { grantCode: "other", open: true },
      { grantCode: "woodland", open: true },
    ]);
  });
  it.each([undefined, null, "true", "false", 0, 1])(
    "rejects invalid status %j without creating settings",
    async (open) => {
      expect((await put(open)).statusCode).toBe(400);
      expect(documents).toEqual([]);
    },
  );
  it("enforces grant-specific roles on reads and writes", async () => {
    roles = ["ROLE_OTHER_ADMIN"];
    expect((await get()).statusCode).toBe(403);
    expect((await put(true)).statusCode).toBe(403);
    expect(documents).toEqual([]);
  });
  it("preserves an unavailable role lookup as a 503", async () => {
    findCwUserRoles.mockResolvedValue({ roles: null, failure: "unavailable" });
    expect((await get()).statusCode).toBe(503);
    expect((await put(true)).statusCode).toBe(503);
    expect(documents).toEqual([]);
  });
  it("returns not found for unknown grants without creating settings", async () => {
    grant = null;
    expect((await get()).statusCode).toBe(404);
    expect((await put(true)).statusCode).toBe(404);
    expect(documents).toEqual([]);
  });
  it("records the old and new settings with the write transaction", async () => {
    await put(true);
    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "SUCCESS",
        entities: [
          {
            entity: "GRANT",
            action: "SAVE_GRANT_SETTINGS",
            entityid: "woodland",
          },
        ],
        details: {
          caller: "fg-grants-platform-admin",
          oldSettings: { grantCode: "woodland", open: false },
          newSettings: { grantCode: "woodland", open: true },
        },
      }),
      session,
    );
  });
  it("does not persist settings when the success audit fails", async () => {
    writeAuditEvent.mockRejectedValue(new Error("audit unavailable"));
    expect((await put(true)).statusCode).toBe(500);
    expect(documents).toEqual([]);
  });
  it("does not treat a failed settings read as a closed grant", async () => {
    const original = db.collection.getMockImplementation();
    db.collection.mockImplementation((name) =>
      name === "grant_settings"
        ? {
            findOne: async () => {
              throw new Error("database unavailable");
            },
          }
        : original(name),
    );
    expect((await get()).statusCode).toBe(500);
    await expect(checkGrantAllowListUseCase(applicant)).rejects.toThrow(
      "database unavailable",
    );
  });
});
