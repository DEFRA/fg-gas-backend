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
import { viewOverviewUseCase } from "../use-cases/view-overview.use-case.js";
import { buildOverviewView } from "../view-models/build-overview-view.js";
import { viewOverviewRoute } from "./view-overview.route.js";

vi.mock("../../common/logger.js");
vi.mock("../use-cases/view-overview.use-case.js");
vi.mock("../view-models/build-overview-view.js");

const OID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const ACTOR = "UTF-8''%C5%81ukasz";
const HEADERS = { "x-actor": ACTOR, "x-actor-id": OID };
const CALLER_HASH = "c".repeat(64);

const FROM = "2026-10-12T15:00:00.000Z";
const AT = "2026-10-13T15:00:00.000Z";

const read = (data) => ({ data, sourceError: null });

const notRead = {
  data: null,
  sourceError: { hop: "CW-BE", reason: "TIMED_OUT" },
};

const OVERVIEW = {
  at: AT,
  window: { from: FROM, to: AT },
  countCap: 10_000,
  deadLetters: {
    gas: read({
      count: 2,
      capped: false,
      bars: [{ from: FROM, to: AT, count: 2, capped: false }],
      lists: [
        {
          box: "inbox",
          count: 2,
          capped: false,
          list: {
            path: "events/gas/inbox",
            query: { status: "DEAD_LETTER", from: FROM, to: AT },
          },
        },
      ],
    }),
    cw: notRead,
  },
  topErrors: {
    gas: read({
      entries: [
        {
          errorKey: null,
          event: null,
          count: 2,
          capped: false,
          lastAt: null,
          list: { path: "events/gas/inbox", query: { status: "DEAD_LETTER" } },
        },
      ],
      more: false,
      complete: true,
    }),
    cw: notRead,
  },
  configFailed: {
    gas: read({
      versions: [
        {
          code: "frps",
          version: "1.11.0",
          definition: "permanent_error",
          receivedAt: AT,
        },
      ],
      more: false,
    }),
    cw: { data: null, sourceError: { hop: "CW-BE", reason: "NOT_OFFERED" } },
  },
  tokensExpiring: {
    gas: read({
      withinDays: 30,
      tokens: [
        {
          tokenId: "6650c1f2a9e4b1d07c20bd91",
          clientId: "grants-ui",
          tokenHint: "ab12",
          status: "ACTIVE",
          createdAt: new Date(FROM),
          createdBy: "Ada Lovelace",
          expiresAt: new Date(AT),
          revokedAt: null,
          revokedBy: null,
          inUse: false,
        },
      ],
    }),
    cw: notRead,
  },
};

// What the use case read, which the route shapes for the page.
const READ = { at: AT, read: true };

describe("viewOverviewRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.auth.scheme("test", () => ({
      authenticate: (_, h) =>
        h.authenticated({
          credentials: {
            service: "fg-grants-platform-admin",
            tokenHash: CALLER_HASH,
          },
        }),
    }));
    server.auth.strategy("test", "test");
    server.auth.default("test");
    server.route(viewOverviewRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    viewOverviewUseCase.mockResolvedValue(READ);
    buildOverviewView.mockReturnValue(OVERVIEW);
  });

  const get = (headers = HEADERS) =>
    server.inject({ method: "GET", url: "/grant-admin/overview", headers });

  it("answers the overview, never to be stored, naming the operator and caller", async () => {
    const response = await get();

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(JSON.parse(response.payload)).toEqual(
      JSON.parse(JSON.stringify(OVERVIEW)),
    );
    expect(viewOverviewUseCase).toHaveBeenCalledExactlyOnceWith({
      actor: ACTOR,
      decodedActor: "Łukasz",
      caller: "fg-grants-platform-admin",
      callerHash: CALLER_HASH,
    });
    expect(buildOverviewView).toHaveBeenCalledExactlyOnceWith(READ);
  });

  it("refuses an operator name that reads as a hash", async () => {
    const response = await get({ ...HEADERS, "x-actor": "a".repeat(64) });

    expect(response.statusCode).toBe(400);
    expect(viewOverviewUseCase).not.toHaveBeenCalled();
  });

  it.each([
    ["no operator", { "x-actor-id": OID }],
    ["no operator id", { "x-actor": ACTOR }],
  ])("refuses a read that names %s", async (_, headers) => {
    const response = await get(headers);

    expect(response.statusCode).toBe(400);
    expect(viewOverviewUseCase).not.toHaveBeenCalled();
  });

  it("refuses to answer a part that is both read and not", async () => {
    buildOverviewView.mockReturnValue({
      ...OVERVIEW,
      deadLetters: {
        ...OVERVIEW.deadLetters,
        cw: { ...OVERVIEW.deadLetters.gas, sourceError: notRead.sourceError },
      },
    });

    const response = await get();

    expect(response.statusCode).toBe(500);
  });
});
