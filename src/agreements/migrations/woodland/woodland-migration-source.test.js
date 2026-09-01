import { Decimal128 } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../../common/config.js";
import { wreck } from "../../../common/wreck.js";
import {
  fetchWoodlandAgreementNumbers,
  fetchWoodlandAgreementVersionPages,
} from "./woodland-migration-source.js";

vi.mock("../../../common/wreck.js", () => ({
  wreck: { get: vi.fn() },
}));

const originalConfig = { ...config.woodlandMigration };

const response = (payload, statusCode = 200) => ({ payload, statusCode });

beforeEach(() => {
  Object.assign(config.woodlandMigration, {
    sourceUrl: "https://agreements.example.test",
    token: "migration-secret",
  });
});

afterEach(() => {
  vi.resetAllMocks();
  Object.assign(config.woodlandMigration, originalConfig);
});

describe("Woodland migration source", () => {
  it("fetches the Woodland agreement-number list with the migration token", async () => {
    wreck.get.mockResolvedValue(
      response({ agreementNumbers: ["WMP0001", "WMP0002"] }),
    );

    await expect(fetchWoodlandAgreementNumbers()).resolves.toEqual([
      "WMP0001",
      "WMP0002",
    ]);
    expect(wreck.get).toHaveBeenCalledWith(
      "https://agreements.example.test/internal/migrations/woodland/agreements",
      {
        headers: { authorization: "Bearer migration-secret" },
        json: true,
        timeout: 30_000,
      },
    );
  });

  it("pages internally and deserializes exact BSON decimal values", async () => {
    wreck.get
      .mockResolvedValueOnce(
        response({
          agreement: { agreementNumber: "WMP0001" },
          grant: { agreementNumber: "WMP0001" },
          versions: [
            {
              displayedQuantity: {
                $numberDecimal: "4.757500000000000001",
              },
            },
          ],
          nextOffset: 100,
        }),
      )
      .mockResolvedValueOnce(
        response({
          agreement: { agreementNumber: "WMP0001" },
          grant: { agreementNumber: "WMP0001" },
          versions: [{}],
          nextOffset: null,
        }),
      );

    const pages = [];
    for await (const page of fetchWoodlandAgreementVersionPages("WMP0001")) {
      pages.push(page);
    }

    expect(pages).toHaveLength(2);
    expect(pages[0].versions[0].displayedQuantity).toBeInstanceOf(Decimal128);
    expect(pages[0].versions[0].displayedQuantity.toString()).toBe(
      "4.757500000000000001",
    );
    expect(wreck.get.mock.calls.map(([url]) => url)).toEqual([
      "https://agreements.example.test/internal/migrations/woodland/agreements/WMP0001/versions?offset=0",
      "https://agreements.example.test/internal/migrations/woodland/agreements/WMP0001/versions?offset=100",
    ]);
  });

  it("rejects invalid source responses without exposing their contents", async () => {
    wreck.get.mockResolvedValue(response({ agreementNumbers: ["FPTT0001"] }));

    await expect(fetchWoodlandAgreementNumbers()).rejects.toMatchObject({
      message: "Woodland migration source request failed",
      output: { statusCode: 502 },
    });
  });
});
