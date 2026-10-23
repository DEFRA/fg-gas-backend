import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../common/logger.js";
import { findStoredAgreementDefinitionDocument } from "../repositories/agreement-definition.repository.js";
import { validateEndpointServiceUrls } from "../services/integrations/resolve-endpoint-service-url.js";
import { findStoredAgreementDefinition } from "./find-stored-agreement-definition.js";

vi.mock("../../common/logger.js");
vi.mock("../repositories/agreement-definition.repository.js");

const REF = { grantCode: "pigs-might-fly", version: "1.0.0" };
const OPTIONS = { maxBytes: 1024 };

const seeded = () =>
  JSON.parse(
    readFileSync(
      new URL(
        "../../../compose/seed/pigs-might-fly/1.0.0/gas/agreement.json",
        import.meta.url,
      ),
    ),
  );

const storing = (definition) =>
  findStoredAgreementDefinitionDocument.mockResolvedValue({
    definition,
    storedBytes: 512,
  });

const withRootEndpoints = (definition) => ({
  ...definition,
  endpoints: [
    {
      code: "PARCELS",
      method: "GET",
      service: "GRANT_FUNDING_CALCULATOR",
      path: "/parcels/{sbi}",
    },
    { code: "DOCS", method: "POST", service: "AGREEMENT_DOCS", path: "/docs" },
  ],
});

const withLandData = (definition) => ({
  ...definition,
  processDefinitions: {
    ...definition.processDefinitions,
    FETCH_PARCELS: {
      type: "endpoint",
      endpoint: { method: "GET", service: "LAND_DATA", path: "/parcels/{sbi}" },
      request: { body: { scheme: "pigs" } },
      output: { parcels: "$.response.parcels" },
    },
  },
});

describe("findStoredAgreementDefinition", () => {
  beforeEach(() => {
    vi.stubEnv("GRANT_FUNDING_CALCULATOR_URL", "https://calc.test/api/");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("reads the stored document for the grant's version under the cap", async () => {
    storing(seeded());

    await findStoredAgreementDefinition(REF, OPTIONS);

    expect(findStoredAgreementDefinitionDocument).toHaveBeenCalledWith(
      "pigs-might-fly",
      "1.0.0",
      OPTIONS,
    );
  });

  it("is null when nothing is stored", async () => {
    findStoredAgreementDefinitionDocument.mockResolvedValue(null);

    expect(await findStoredAgreementDefinition(REF, OPTIONS)).toBeNull();
  });

  it("has no definition and no addresses when the definition is too large", async () => {
    findStoredAgreementDefinitionDocument.mockResolvedValue({
      definition: null,
      storedBytes: 2048,
    });

    expect(await findStoredAgreementDefinition(REF, OPTIONS)).toEqual({
      definition: null,
      addresses: [],
      endpointAddresses: [],
      missingServiceUrls: [],
      problem: null,
    });
  });

  it("gives a usable definition as stored, with a Service Address per endpoint process in definition order", async () => {
    const definition = withLandData(seeded());
    storing(definition);

    const found = await findStoredAgreementDefinition(REF, OPTIONS);

    expect(found).toEqual({
      definition: withLandData(seeded()),
      addresses: [
        {
          process: "GENERATE_OFFER",
          service: "GRANT_FUNDING_CALCULATOR",
          url: "https://calc.test/api/paymentSchedule",
        },
        { process: "FETCH_PARCELS", service: "LAND_DATA", url: null },
      ],
      endpointAddresses: [],
      missingServiceUrls: ["LAND_DATA_URL"],
      problem: null,
    });
    expect(found.definition).toBe(definition);
  });

  it("gives a Service Address per root endpoint in definition order", async () => {
    storing(withRootEndpoints(seeded()));

    expect(
      (await findStoredAgreementDefinition(REF, OPTIONS)).endpointAddresses,
    ).toEqual([
      {
        code: "PARCELS",
        service: "GRANT_FUNDING_CALCULATOR",
        url: "https://calc.test/api/parcels/{sbi}",
      },
      { code: "DOCS", service: "AGREEMENT_DOCS", url: null },
    ]);
  });

  it("leaves the query and fragment out of root endpoint and endpoint process addresses", async () => {
    vi.stubEnv("LAND_DATA_URL", "https://land.test/");
    const withQueries = (definition) => ({
      ...definition,
      endpoints: [
        {
          code: "PARCELS",
          method: "GET",
          service: "LAND_DATA",
          path: "/parcels/{sbi}?mode=full#details",
        },
      ],
      processDefinitions: {
        ...definition.processDefinitions,
        FETCH_PARCELS: {
          type: "endpoint",
          endpoint: {
            method: "GET",
            service: "LAND_DATA",
            path: "/parcels/{sbi}#details",
          },
          request: { body: { scheme: "pigs" } },
          output: { parcels: "$.response.parcels" },
        },
      },
    });
    storing(withQueries(seeded()));

    const found = await findStoredAgreementDefinition(REF, OPTIONS);

    expect(found.endpointAddresses).toEqual([
      {
        code: "PARCELS",
        service: "LAND_DATA",
        url: "https://land.test/parcels/{sbi}",
      },
    ]);
    expect(found.addresses).toContainEqual({
      process: "FETCH_PARCELS",
      service: "LAND_DATA",
      url: "https://land.test/parcels/{sbi}",
    });
  });

  it.each([
    ["a root endpoint", withRootEndpoints],
    ["an endpoint process", withLandData],
  ])(
    "names the unset service URLs the runtime would refuse, for %s",
    async (_case, change) => {
      const definition = change(seeded());
      storing(definition);

      const { missingServiceUrls } = await findStoredAgreementDefinition(
        REF,
        OPTIONS,
      );

      expect(missingServiceUrls.length).toBeGreaterThan(0);
      expect(() => validateEndpointServiceUrls([definition])).toThrow(
        `Missing required endpoint URL env var(s): ${missingServiceUrls.join(", ")}`,
      );
    },
  );

  it("names no unset service URL when every service has one", async () => {
    storing(seeded());

    expect(
      (await findStoredAgreementDefinition(REF, OPTIONS)).missingServiceUrls,
    ).toEqual([]);
  });

  it.each([
    [
      "a code that is not the grant's",
      (raw) => ({ ...raw, code: "some-other-grant" }),
      'Agreement definition code "some-other-grant" does not match "pigs-might-fly"',
    ],
    [
      "a declared configVersion",
      (raw) => ({ ...raw, configVersion: "9.9.9" }),
      'Agreement definition "pigs-might-fly" must not declare configVersion; it is applied from the config catalog',
    ],
    [
      "an unknown create target",
      (raw) => ({ ...raw, create: { ...raw.create, target: "nowhere" } }),
      expect.stringContaining("nowhere"),
    ],
  ])(
    "gives a definition GAS cannot load as stored, with %s as its problem",
    async (_case, change, problem) => {
      const definition = change(seeded());
      storing(definition);

      expect(await findStoredAgreementDefinition(REF, OPTIONS)).toEqual({
        definition,
        addresses: [],
        endpointAddresses: [],
        missingServiceUrls: [],
        problem,
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("pigs-might-fly@1.0.0"),
      );
    },
  );

  it("takes the process compile's own words as the problem", async () => {
    const definition = seeded();
    definition.processDefinitions.GENERATE_OFFER.request.body.agreementStartDate =
      "jsonata:$lookup($.outputs, $.execution.target)";
    storing(definition);

    expect(await findStoredAgreementDefinition(REF, OPTIONS)).toEqual({
      definition,
      addresses: [],
      endpointAddresses: [],
      missingServiceUrls: [],
      problem:
        'Agreement Process "GENERATE_OFFER" has an invalid output dependency: Dynamic Agreement Process output lookup is not supported',
    });
  });

  it("cuts a long problem to 500 characters", async () => {
    storing({ ...seeded(), code: "x".repeat(600) });

    const { problem } = await findStoredAgreementDefinition(REF, OPTIONS);

    expect(problem).toBe(`Agreement definition code "${"x".repeat(473)}`);
  });
});
