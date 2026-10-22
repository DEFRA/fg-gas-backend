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
import { grantVersionNotFound } from "../services/grant-not-found.js";
import { viewGrantVersionPageUseCase } from "../use-cases/view-grant-version-page.use-case.js";
import { viewGrantVersionPhasesRoute } from "./view-grant-version-phases.route.js";

vi.mock("../../common/logger.js");
vi.mock("../use-cases/view-grant-version-page.use-case.js");

const OID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const HEADERS = { "x-actor": "Jo Operator", "x-actor-id": OID };

const HEADER = {
  code: "woodland",
  version: "2.0.0",
  status: "draft",
  receivedAt: "2026-10-15T10:04:00.000Z",
  files: {
    grant: { stored: false, fetchStatus: "pending" },
    payment: { stored: false, fetchStatus: "permanent_error" },
  },
  versions: [
    {
      version: "2.0.0",
      status: "draft",
      receivedAt: "2026-10-15T10:04:00.000Z",
    },
  ],
  counterpart: { exists: true },
};

const LIFECYCLE = {
  phases: [
    {
      code: "PRE_AWARD",
      name: "Pre award",
      stages: [
        {
          code: "APPLICATION",
          name: null,
          statuses: [{ code: "RECEIVED" }, { code: "AMEND" }],
        },
      ],
    },
  ],
  initialPosition: "PRE_AWARD:APPLICATION:RECEIVED",
  amendablePositions: ["PRE_AWARD:APPLICATION:AMEND"],
  waysIn: [
    { to: "PRE_AWARD:APPLICATION:RECEIVED", kind: "any", processes: [] },
    {
      to: "PRE_AWARD:APPLICATION:AMEND",
      kind: "move",
      from: "PRE_AWARD:APPLICATION:RECEIVED",
      processes: ["NOTIFY"],
    },
    {
      to: "PRE_AWARD:APPLICATION:AMEND",
      kind: "unmatched",
      code: "ON_HOLD",
      processes: [],
    },
  ],
  externalMappings: [
    {
      source: "CW",
      code: "PRE_AWARD:REVIEW:IN_REVIEW",
      whileIn: "PRE_AWARD:APPLICATION",
      mappedTo: "::AMEND",
      to: "PRE_AWARD:APPLICATION:AMEND",
    },
    {
      source: "AS",
      code: "offered",
      whileIn: "PRE_AWARD:APPLICATION",
      mappedTo: "S:X",
      to: null,
    },
  ],
  claimApproval: {
    from: "PRE_AWARD:APPLICATION:RECEIVED",
    to: "PRE_AWARD:APPLICATION:AMEND",
  },
};

const PAGE = {
  header: HEADER,
  lifecycle: LIFECYCLE,
  problem: null,
  sourceErrors: [],
  sectionErrors: [],
};

describe("viewGrantVersionPhasesRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.ext("onRequest", (request, h) => {
      request.auth.credentials = { service: "fg-grants-platform-admin" };
      return h.continue;
    });
    server.route(viewGrantVersionPhasesRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    viewGrantVersionPageUseCase.mockResolvedValue(PAGE);
  });

  const get = (headers = HEADERS, version = "2.0.0", code = "woodland") =>
    server.inject({
      method: "GET",
      url: `/grant-admin/grants/${code}/versions/${version}/phases`,
      headers,
    });

  it("answers the grant's lifecycle, never to be stored, in one use-case call", async () => {
    const response = await get();

    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual(PAGE);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(viewGrantVersionPageUseCase).toHaveBeenCalledWith({
      code: "woodland",
      version: "2.0.0",
      tab: "phases",
      caller: "fg-grants-platform-admin",
    });
  });

  it("answers 404 with its reason for an unknown version", async () => {
    viewGrantVersionPageUseCase.mockRejectedValue(grantVersionNotFound());

    const response = await get();

    expect(response.statusCode).toBe(404);
    expect(response.result.reason).toBe("GRANT_VERSION_NOT_FOUND");
  });

  it.each([
    ["no x-actor", { "x-actor-id": OID }],
    ["no x-actor-id", { "x-actor": "Jo" }],
  ])("refuses %s with 400", async (_name, headers) => {
    expect((await get(headers)).statusCode).toBe(400);
    expect(viewGrantVersionPageUseCase).not.toHaveBeenCalled();
  });

  it.each([
    ["a version that is not semver", "2.0", "woodland"],
    ["a code outside the code alphabet", "2.0.0", "Woodland"],
  ])("refuses %s with 400", async (_name, version, code) => {
    expect((await get(HEADERS, version, code)).statusCode).toBe(400);
    expect(viewGrantVersionPageUseCase).not.toHaveBeenCalled();
  });

  it.each([
    [
      "why the stored grant has no lifecycle",
      { lifecycle: null, problem: 'Grant "woodland" has no initial position' },
    ],
    [
      "neither when the grant file is not stored",
      { lifecycle: null, problem: null },
    ],
    [
      "a lifecycle that could not be read as a section error",
      {
        lifecycle: null,
        problem: null,
        sectionErrors: [{ section: "phases", message: "read failed" }],
      },
    ],
  ])("answers %s", async (_name, fields) => {
    const page = { ...PAGE, ...fields };
    viewGrantVersionPageUseCase.mockResolvedValue(page);

    const response = await get();

    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual(page);
  });

  it("refuses to answer a move with no source", async () => {
    const [, move] = LIFECYCLE.waysIn;
    const { from: _from, ...sourceless } = move;
    viewGrantVersionPageUseCase.mockResolvedValue({
      ...PAGE,
      lifecycle: { ...LIFECYCLE, waysIn: [sourceless] },
    });

    expect((await get()).statusCode).toBe(500);
  });
});
