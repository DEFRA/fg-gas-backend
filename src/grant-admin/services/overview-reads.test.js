import { describe, expect, it, vi } from "vitest";
import { expiringTokens } from "./overview-reads.js";

vi.mock("../../common/logger.js");
vi.mock("../../common/mongo-client.js");

const NOW = new Date("2026-10-13T15:00:00.000Z");

const token = (tokenId, status, expiresAt) => ({
  tokenId,
  status,
  expiresAt: expiresAt && new Date(expiresAt),
});

describe("expiringTokens", () => {
  it("keeps the active ones expiring in under 30 days and the expired, soonest first", () => {
    const tokens = expiringTokens(
      [
        token("later", "ACTIVE", "2026-11-12T15:00:00.000Z"),
        token("soon", "ACTIVE", "2026-10-20T00:00:00.000Z"),
        token("edge", "ACTIVE", "2026-11-12T14:59:59.999Z"),
        token("gone", "EXPIRED", "2026-10-01T00:00:00.000Z"),
        token("never", "ACTIVE", null),
        token("revoked", "REVOKED", "2026-10-14T00:00:00.000Z"),
      ],
      NOW,
    );

    expect(tokens.map(({ tokenId }) => tokenId)).toEqual([
      "gone",
      "soon",
      "edge",
    ]);
  });
});
