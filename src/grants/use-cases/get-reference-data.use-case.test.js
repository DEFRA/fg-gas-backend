import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestGrant } from "../../../test/helpers/grants.js";
import { DbReferenceData } from "../models/db-reference-data.js";
import { findByGrantCodeAndName } from "../repositories/reference-data.repository.js";
import { resolveAndFetchGrant } from "../services/resolve-config-version.service.js";
import { getReferenceDataUseCase } from "./get-reference-data.use-case.js";

vi.mock("../services/resolve-config-version.service.js");
vi.mock("../repositories/reference-data.repository.js");

const grant = createTestGrant({
  code: "pigs-might-fly",
  referenceData: [
    {
      name: "fly-inline",
      source: {
        type: "inline",
        items: [{ code: "WINGS", description: "Wings" }],
      },
    },
    { name: "fly-db", source: { type: "db" } },
  ],
});

describe("getReferenceDataUseCase", () => {
  beforeEach(() => {
    resolveAndFetchGrant.mockResolvedValue({ grant });
  });

  it("answers an inline set from the definition", async () => {
    await expect(
      getReferenceDataUseCase({ code: "pigs-might-fly", name: "fly-inline" }),
    ).resolves.toEqual({
      name: "fly-inline",
      source: "inline",
      items: [{ code: "WINGS", description: "Wings" }],
    });
  });

  it("answers a db set from what GAS holds", async () => {
    findByGrantCodeAndName.mockResolvedValue(
      DbReferenceData.fromDocument({
        grantCode: "pigs-might-fly",
        name: "fly-db",
        items: [{ code: "GLIDERS", description: "Gliders" }],
        updatedAt: null,
      }),
    );

    await expect(
      getReferenceDataUseCase({ code: "pigs-might-fly", name: "fly-db" }),
    ).resolves.toEqual({
      name: "fly-db",
      source: "db",
      items: [{ code: "GLIDERS", description: "Gliders" }],
    });
    expect(findByGrantCodeAndName).toHaveBeenCalledWith(
      "pigs-might-fly",
      "fly-db",
    );
  });

  it("answers an empty db set before any items are added", async () => {
    findByGrantCodeAndName.mockResolvedValue(null);

    await expect(
      getReferenceDataUseCase({ code: "pigs-might-fly", name: "fly-db" }),
    ).resolves.toMatchObject({ items: [] });
  });

  it("is not found for a set the grant does not declare", async () => {
    await expect(
      getReferenceDataUseCase({ code: "pigs-might-fly", name: "swim" }),
    ).rejects.toMatchObject({ output: { statusCode: 404 } });
  });
});
