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
import { applicationNotFound } from "../services/application-page.js";
import { viewApplicationPageUseCase } from "../use-cases/view-application-page.use-case.js";
import { applicationPageRoutes } from "./record-page.routes.js";

vi.mock("../../common/logger.js");
vi.mock(
  "../use-cases/view-application-page.use-case.js",
  async (importOriginal) => ({
    ...(await importOriginal()),
    viewApplicationPageUseCase: vi.fn(),
  }),
);

const OID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const HEADERS = { "x-actor": "Jo Operator", "x-actor-id": OID };

const HEADER = {
  clientRef: "ref-1",
  code: "woodland",
  position: { phase: null, stage: null, status: null },
  counterpart: null,
  fetchedAt: "2026-06-16T10:00:00.000Z",
};

const PAGES = {
  overview: {
    header: HEADER,
    overview: {
      code: "woodland",
      originalConfigVersion: null,
      currentConfigVersion: null,
      submittedAt: null,
      createdAt: null,
      updatedAt: null,
      identifiers: { sbi: null, frn: null, crn: null },
      series: null,
      storedBytes: 10,
    },
    sourceErrors: [],
    sectionErrors: [],
  },
  events: {
    header: HEADER,
    events: { rows: [], more: false },
    sourceErrors: [],
    sectionErrors: [],
  },
  raw: {
    header: HEADER,
    raw: { anything: { at: ["all"] } },
    storedBytes: 10,
    sourceErrors: [],
    sectionErrors: [],
  },
};

describe("applicationPageRoutes", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.ext("onRequest", (request, h) => {
      request.auth.credentials = { service: "fg-grants-platform-admin" };
      return h.continue;
    });
    server.route(applicationPageRoutes);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    viewApplicationPageUseCase.mockImplementation(
      async ({ tab }) => PAGES[tab],
    );
  });

  const get = (tab, headers = HEADERS, ref = "ref-1") =>
    server.inject({
      method: "GET",
      url: `/grant-admin/grants/woodland/applications/${ref}/${tab}`,
      headers,
    });

  it("generates one GET per application tab", () => {
    expect(
      applicationPageRoutes.map(({ method, path }) => `${method} ${path}`),
    ).toEqual([
      "GET /grant-admin/grants/{code}/applications/{clientRef}/overview",
      "GET /grant-admin/grants/{code}/applications/{clientRef}/events",
      "GET /grant-admin/grants/{code}/applications/{clientRef}/raw",
    ]);
  });

  it.each(["overview", "events", "raw"])(
    "answers the %s page, never to be stored, in one use-case call",
    async (tab) => {
      const response = await get(tab);

      expect(response.statusCode).toBe(200);
      expect(response.result).toEqual(PAGES[tab]);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(viewApplicationPageUseCase).toHaveBeenCalledWith({
        code: "woodland",
        clientRef: "ref-1",
        tab,
        caller: "fg-grants-platform-admin",
      });
    },
  );

  it("answers 404 with its reason for an unknown application", async () => {
    viewApplicationPageUseCase.mockRejectedValue(applicationNotFound());

    const response = await get("overview");

    expect(response.statusCode).toBe(404);
    expect(response.result.reason).toBe("APPLICATION_NOT_FOUND");
  });

  it.each([
    ["no x-actor", { "x-actor-id": OID }],
    ["no x-actor-id", { "x-actor": "Jo" }],
  ])("refuses %s with 400", async (_name, headers) => {
    expect((await get("raw", headers)).statusCode).toBe(400);
    expect(viewApplicationPageUseCase).not.toHaveBeenCalled();
  });

  it("refuses a ref outside the clientRef alphabet with 400", async () => {
    expect((await get("raw", HEADERS, "REF_1")).statusCode).toBe(400);
  });

  it("refuses a page that names another tab's key", async () => {
    viewApplicationPageUseCase.mockResolvedValue({
      ...PAGES.raw,
      overview: PAGES.overview.overview,
    });

    expect((await get("raw")).statusCode).toBe(500);
  });
});
