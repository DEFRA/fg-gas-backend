import hapi from "@hapi/hapi";
import { BSON } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { viewCasePageUseCase } from "../use-cases/view-case-page.use-case.js";
import { viewCaseRawRoute } from "./view-case-raw.route.js";

vi.mock("../../common/logger.js");
vi.mock("../use-cases/view-case-page.use-case.js");

const OID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const HEADERS = { "x-actor": "Jo Operator", "x-actor-id": OID };

const CASE_HEADER = {
  caseRef: "ref-1",
  workflowCode: "frps-private-beta",
  position: { phase: null, stage: null, status: null },
  version: "1.0.0",
  names: null,
  closed: false,
  closedAt: null,
  counterpart: { exists: true },
  fetchedAt: "2026-06-16T10:00:00.000Z",
};

const PAGE = {
  header: CASE_HEADER,
  document: BSON.serialize({ caseRef: "ref-1", payload: {} }).toString(
    "base64",
  ),
  storedBytes: 10,
  sourceErrors: [],
  sectionErrors: [],
};

describe("viewCaseRawRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.ext("onRequest", (request, h) => {
      request.auth.credentials = { service: "fg-grants-platform-admin" };
      return h.continue;
    });
    server.route(viewCaseRawRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  const get = (headers = HEADERS) =>
    server.inject({
      method: "GET",
      url: "/grant-admin/workflows/frps-private-beta/cases/ref-1/raw",
      headers,
    });

  it("answers the raw page, passing the encoded operator name to Caseworking's read", async () => {
    viewCasePageUseCase.mockResolvedValue(PAGE);

    const response = await get();

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(viewCasePageUseCase).toHaveBeenCalledWith({
      workflowCode: "frps-private-beta",
      caseRef: "ref-1",
      tab: "raw",
      caller: "fg-grants-platform-admin",
      actor: "Jo Operator",
    });
  });

  it("answers the stored case as base64 BSON and no `raw`, which a GPA reading it finds gone", async () => {
    viewCasePageUseCase.mockResolvedValue(PAGE);

    const { result } = await get();

    expect(result.document).toBe(PAGE.document);
    expect(result).not.toHaveProperty("raw");
  });

  it("answers a case too large to show by its size alone", async () => {
    const page = {
      ...PAGE,
      document: null,
      storedBytes: 2 * 1024 * 1024,
      sectionErrors: [{ section: "raw", message: "too large to show" }],
    };
    viewCasePageUseCase.mockResolvedValue(page);

    expect((await get()).result).toEqual(page);
  });

  it.each([
    ["the old `raw` object", { raw: { caseRef: "ref-1" } }],
    ["a document that isn't base64", { document: "{not base64}" }],
  ])("refuses a page carrying %s", async (_, extra) => {
    viewCasePageUseCase.mockResolvedValue({ ...PAGE, ...extra });

    expect((await get()).statusCode).toBe(500);
  });

  it("refuses a request with no x-actor-id", async () => {
    expect((await get({ "x-actor": "Jo" })).statusCode).toBe(400);
  });
});
