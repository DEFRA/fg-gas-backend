import { MongoServerError } from "mongodb";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { insertAgreementDefinition } from "../repositories/agreement-definition.repository.js";
import { storeAgreementDefinition } from "./store-agreement-definition.js";

vi.mock("../../common/logger.js");
vi.mock("../repositories/agreement-definition.repository.js");

const CODE = "pigs-might-fly";

const definition = () =>
  JSON.parse(
    readFileSync(
      new URL(
        "../../../compose/seed/pigs-might-fly/1.0.0/gas/agreement.json",
        import.meta.url,
      ),
    ),
  );

beforeEach(() => {
  vi.resetAllMocks();
});

describe("storeAgreementDefinition", () => {
  it("stores the definition as published, under the grant and version", async () => {
    const published = definition();

    await storeAgreementDefinition({
      grantCode: CODE,
      version: "1.2.0",
      definition: published,
    });

    expect(insertAgreementDefinition).toHaveBeenCalledWith({
      code: CODE,
      version: "1.2.0",
      definition: published,
    });
  });

  it("refuses a definition arrival would refuse and stores nothing", async () => {
    await expect(
      storeAgreementDefinition({
        grantCode: CODE,
        version: "1.2.0",
        definition: { ...definition(), configVersion: "1.0.0" },
      }),
    ).rejects.toMatchObject({ isBoom: true });

    expect(insertAgreementDefinition).not.toHaveBeenCalled();
  });

  it("lets any other Mongo failure through", async () => {
    const failure = new MongoServerError({ message: "down", code: 6 });
    insertAgreementDefinition.mockRejectedValue(failure);

    await expect(
      storeAgreementDefinition({
        grantCode: CODE,
        version: "1.2.0",
        definition: definition(),
      }),
    ).rejects.toBe(failure);
  });
});
