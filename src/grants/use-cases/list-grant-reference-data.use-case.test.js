import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestGrant } from "../../../test/helpers/grants.js";
import { DbReferenceData } from "../models/db-reference-data.js";
import { findByGrantCode } from "../repositories/reference-data.repository.js";
import { loadEndpointReferenceData } from "../services/reference-data-sources/endpoint.source.js";
import { resolveAndFetchGrant } from "../services/resolve-config-version.service.js";
import {
  listGrantReferenceDataUseCase,
  viewGrantReferenceDataUseCase,
} from "./list-grant-reference-data.use-case.js";
import { resolveGrantAdministration } from "./resolve-grant-administration.use-case.js";
import { ReferenceDataSet } from "../models/reference-data-set.js";

vi.mock("../repositories/reference-data.repository.js");
vi.mock("../services/reference-data-sources/endpoint.source.js");
vi.mock("../services/resolve-config-version.service.js");
vi.mock("./resolve-grant-administration.use-case.js");

const grant = createTestGrant({
  code: "pigs-might-fly",
  endpoints: [
    {
      code: "pmf-reference",
      method: "GET",
      service: "GRANT_FUNDING_CALCULATOR",
      path: "/reference/{name}",
      output: { items: { itemsRef: "$.response.options", items: {} } },
    },
  ],
  referenceData: [
    { name: "fly", source: { type: "endpoint", endpoint: "pmf-reference" } },
    {
      name: "pig-colour",
      source: {
        type: "inline",
        items: [{ code: "PINK", description: "Pink" }],
      },
    },
    { name: "landing-site", source: { type: "db" } },
    { name: "runway", source: { type: "db" } },
  ],
});
const args = {
  grantCode: "pigs-might-fly",
  caller: "fg-grants-platform-admin",
};

describe("Grant Admin reference data reads", () => {
  beforeEach(() => {
    resolveGrantAdministration.mockResolvedValue();
    resolveAndFetchGrant.mockResolvedValue({ grant });
    findByGrantCode.mockResolvedValue([
      DbReferenceData.fromDocument({
        grantCode: "pigs-might-fly",
        name: "landing-site",
        items: [{ code: "BARN", description: "Barn roof" }],
        updatedAt: null,
      }),
    ]);
  });

  it("lists every set, with the items GAS has and without calling any service", async () => {
    await expect(listGrantReferenceDataUseCase(args)).resolves.toEqual({
      grantCode: "pigs-might-fly",
      referenceData: [
        {
          name: "fly",
          source: "endpoint",
          editable: false,
          service: "GRANT_FUNDING_CALCULATOR",
        },
        {
          name: "pig-colour",
          source: "inline",
          editable: false,
          items: [{ code: "PINK", description: "Pink" }],
        },
        {
          name: "landing-site",
          source: "db",
          editable: true,
          items: [{ code: "BARN", description: "Barn roof" }],
        },
        { name: "runway", source: "db", editable: true, items: [] },
      ],
    });
    expect(loadEndpointReferenceData).not.toHaveBeenCalled();
  });

  it("fetches an endpoint set's items when that set is viewed", async () => {
    loadEndpointReferenceData.mockResolvedValue(
      new ReferenceDataSet({
        name: "fly",
        items: [{ code: "WINGS", description: "Wings" }],
      }),
    );

    await expect(
      viewGrantReferenceDataUseCase({ ...args, name: "fly" }),
    ).resolves.toEqual({
      name: "fly",
      source: "endpoint",
      editable: false,
      service: "GRANT_FUNDING_CALCULATOR",
      items: [{ code: "WINGS", description: "Wings" }],
    });
  });

  it("passes on a service that cannot answer", async () => {
    loadEndpointReferenceData.mockRejectedValue(Boom.badGateway("down"));

    await expect(
      viewGrantReferenceDataUseCase({ ...args, name: "fly" }),
    ).rejects.toMatchObject({ output: { statusCode: 502 } });
  });

  it("reads nothing when grant administration is denied", async () => {
    resolveGrantAdministration.mockRejectedValue(Boom.forbidden());

    await expect(listGrantReferenceDataUseCase(args)).rejects.toMatchObject({
      output: { statusCode: 403 },
    });
    expect(findByGrantCode).not.toHaveBeenCalled();
  });
});
