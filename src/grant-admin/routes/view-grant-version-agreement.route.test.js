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
import {
  grantVersionNotFound,
  noDefinitionFile,
} from "../services/grant-not-found.js";
import { viewGrantVersionPageUseCase } from "../use-cases/view-grant-version-page.use-case.js";
import { viewGrantVersionAgreementRoute } from "./view-grant-version-agreement.route.js";

vi.mock("../../common/logger.js");
vi.mock("../use-cases/view-grant-version-page.use-case.js");

const OID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const HEADERS = { "x-actor": "Jo Operator", "x-actor-id": OID };

const HEADER = {
  code: "woodland",
  version: "2.0.0",
  status: "active",
  receivedAt: "2026-10-15T10:04:00.000Z",
  files: {
    grant: { stored: true, fetchStatus: "fetched" },
    agreement: { stored: true, fetchStatus: "fetched" },
  },
  versions: [
    {
      version: "2.0.0",
      status: "active",
      receivedAt: "2026-10-15T10:04:00.000Z",
    },
  ],
};

const PAGE = {
  header: HEADER,
  agreement: {
    definition: { code: "woodland", agreementNumberPrefix: "WC" },
    addresses: [
      {
        process: "FETCH_PARCELS",
        service: "LAND_DATA",
        url: "https://land-data.test/base/api/v2/parcels/{sbi}",
      },
      { process: "GENERATE_OFFER", service: "CALCULATOR", url: null },
    ],
    endpointAddresses: [
      {
        code: "PARCELS",
        service: "LAND_DATA",
        url: "https://land-data.test/base/parcels/{sbi}",
      },
    ],
    missingServiceUrls: ["CALCULATOR_URL"],
    problem: null,
  },
  sourceErrors: [],
  sectionErrors: [],
};

describe("viewGrantVersionAgreementRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.ext("onRequest", (request, h) => {
      request.auth.credentials = { service: "fg-grants-platform-admin" };
      return h.continue;
    });
    server.route(viewGrantVersionAgreementRoute);
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
      url: `/grant-admin/grants/${code}/versions/${version}/agreement`,
      headers,
    });

  it("answers the stored agreement definition and its Service Addresses, never to be stored, in one use-case call", async () => {
    const response = await get();

    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual(PAGE);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(viewGrantVersionPageUseCase).toHaveBeenCalledWith({
      code: "woodland",
      version: "2.0.0",
      tab: "agreement",
      caller: "fg-grants-platform-admin",
    });
  });

  it("answers a definition GAS cannot load as stored, beside its problem", async () => {
    const refused = {
      ...PAGE,
      agreement: {
        definition: { code: "other" },
        addresses: [],
        endpointAddresses: [],
        missingServiceUrls: [],
        problem: 'Agreement definition code "other" does not match "woodland"',
      },
    };
    viewGrantVersionPageUseCase.mockResolvedValue(refused);

    const response = await get();

    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual(refused);
  });

  it.each([
    ["not stored", { ...PAGE, agreement: null }],
    [
      "too large",
      {
        ...PAGE,
        agreement: null,
        sectionErrors: [{ section: "agreement", message: "too large to show" }],
      },
    ],
  ])("answers an agreement %s as null", async (_case, page) => {
    viewGrantVersionPageUseCase.mockResolvedValue(page);

    const response = await get();

    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual(page);
  });

  it.each([
    ["an unknown version", grantVersionNotFound(), "GRANT_VERSION_NOT_FOUND"],
    [
      "a version with no agreement file",
      noDefinitionFile(),
      "NO_DEFINITION_FILE",
    ],
  ])("answers 404 with its reason for %s", async (_case, error, reason) => {
    viewGrantVersionPageUseCase.mockRejectedValue(error);

    const response = await get();

    expect(response.statusCode).toBe(404);
    expect(response.result.reason).toBe(reason);
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

  it("refuses to answer an address without its service", async () => {
    viewGrantVersionPageUseCase.mockResolvedValue({
      ...PAGE,
      agreement: {
        ...PAGE.agreement,
        addresses: [{ process: "FETCH_PARCELS", url: null }],
      },
    });

    expect((await get()).statusCode).toBe(500);
  });

  it("refuses to answer a root endpoint address without its code", async () => {
    viewGrantVersionPageUseCase.mockResolvedValue({
      ...PAGE,
      agreement: {
        ...PAGE.agreement,
        endpointAddresses: [{ service: "LAND_DATA", url: null }],
      },
    });

    expect((await get()).statusCode).toBe(500);
  });
});
