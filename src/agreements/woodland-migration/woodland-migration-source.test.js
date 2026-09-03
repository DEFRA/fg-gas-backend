import { Decimal128 } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../common/config.js";
import { wreck } from "../../common/wreck.js";
import {
  fetchWoodlandAgreementNumbers,
  fetchWoodlandAgreementVersionPages,
} from "./woodland-migration-source.js";

vi.mock("../../common/wreck.js", () => ({
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

  it("rejects an empty Woodland agreement list", async () => {
    wreck.get.mockResolvedValue(response({ agreementNumbers: [] }));

    await expect(fetchWoodlandAgreementNumbers()).rejects.toMatchObject({
      message: "Woodland migration source request failed",
      output: { statusCode: 502 },
    });
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

  it("rejects source network and HTTP errors", async () => {
    wreck.get.mockRejectedValueOnce(new Error("network secret"));
    await expect(fetchWoodlandAgreementNumbers()).rejects.toMatchObject({
      message: "Woodland migration source request failed",
      output: { statusCode: 502 },
    });

    wreck.get.mockResolvedValueOnce(response({}, 503));
    await expect(fetchWoodlandAgreementNumbers()).rejects.toMatchObject({
      message: "Woodland migration source request failed",
      output: { statusCode: 502 },
    });
  });

  it("rejects a source offset that does not move forward", async () => {
    wreck.get
      .mockResolvedValueOnce(
        response({
          agreement: { agreementNumber: "WMP0001" },
          grant: { agreementNumber: "WMP0001" },
          versions: [{}],
          nextOffset: 100,
        }),
      )
      .mockResolvedValueOnce(
        response({
          agreement: { agreementNumber: "WMP0001" },
          grant: { agreementNumber: "WMP0001" },
          versions: [{}],
          nextOffset: 100,
        }),
      );

    const readPages = async () => {
      for await (const page of fetchWoodlandAgreementVersionPages("WMP0001")) {
        expect(page).toBeDefined();
      }
    };

    await expect(readPages()).rejects.toMatchObject({
      message: "Woodland migration source request failed",
      output: { statusCode: 502 },
    });
  });
});
