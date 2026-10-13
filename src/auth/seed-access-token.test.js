import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../common/config.js";
import { logger } from "../common/logger.js";
import { db } from "../common/mongo-client.js";
import { parseTokenHash, seedAccessToken } from "./seed-access-token.js";

vi.mock("../common/mongo-client.js", () => ({
  db: { collection: vi.fn() },
}));

vi.mock("../common/config.js", () => ({
  config: { serviceAccessTokenHash: undefined },
}));

vi.mock("../common/logger.js");

const hash = "a".repeat(64);

describe("parseTokenHash", () => {
  it("parses a client:hash pair", () => {
    expect(parseTokenHash(`some-service:${hash}`)).toEqual({
      client: "some-service",
      id: hash,
    });
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseTokenHash(`  some-service:${hash}  `)).toEqual({
      client: "some-service",
      id: hash,
    });
  });

  it.each([undefined, "", "   "])("treats %o as nothing to seed", (value) => {
    expect(parseTokenHash(value)).toBeNull();
  });

  // A malformed value must not produce `{ id: undefined }`: Mongo serialises
  // that to `{ id: null }`, which upserts a junk record and makes the reconcile
  // delete the client's real token. Rejecting here fails to a no-op instead.
  it.each([
    ["no hash", "some-service"],
    ["empty hash", "some-service:"],
    ["short hash", `some-service:${"a".repeat(63)}`],
    ["long hash", `some-service:${"a".repeat(65)}`],
    ["non-hex hash", `some-service:${"z".repeat(64)}`],
    ["extra colon", `some-service:${hash}:extra`],
    ["no client", `:${hash}`],
  ])("rejects a value with %s rather than seeding junk", (_, value) => {
    expect(parseTokenHash(value)).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe("seedAccessToken", () => {
  let accessTokens;

  beforeEach(() => {
    accessTokens = {
      replaceOne: vi
        .fn()
        .mockResolvedValue({ upsertedCount: 1, modifiedCount: 0 }),
    };

    db.collection.mockReturnValue(accessTokens);
    config.serviceAccessTokenHash = `some-service:${hash}`;
    config.sfdAccessTokenHash = undefined;
  });

  it("replaces the client's seeded record with the configured hash", async () => {
    await seedAccessToken();

    expect(db.collection).toHaveBeenCalledWith("access_tokens");
    expect(accessTokens.replaceOne).toHaveBeenCalledWith(
      { seeded: true, client: "some-service" },
      {
        id: hash,
        client: "some-service",
        clientId: "some-service",
        expiresAt: null,
        seeded: true,
      },
      { upsert: true },
    );
  });

  it("keys the write by client so concurrent boots cannot each add their own", async () => {
    await seedAccessToken();

    const [filter] = accessTokens.replaceOne.mock.calls[0];

    expect(filter).toEqual({ seeded: true, client: "some-service" });
    expect(filter).not.toHaveProperty("id");
  });

  it("does not expire the seeded token", async () => {
    await seedAccessToken();

    const [, replacement] = accessTokens.replaceOne.mock.calls[0];

    expect(replacement.expiresAt).toBeNull();
  });

  it("reports issuing a credential the client did not have", async () => {
    await seedAccessToken();

    expect(logger.info).toHaveBeenCalledWith(
      "Seeded access token for some-service",
    );
  });

  it("reports a rotation that replaced a different hash", async () => {
    accessTokens.replaceOne.mockResolvedValue({
      upsertedCount: 0,
      modifiedCount: 1,
    });

    await seedAccessToken();

    expect(logger.info).toHaveBeenCalledWith(
      "Seeded access token for some-service, replacing the previous one",
    );
  });

  it("does not claim a replacement when a restart changed nothing", async () => {
    accessTokens.replaceOne.mockResolvedValue({
      upsertedCount: 0,
      modifiedCount: 0,
    });

    await seedAccessToken();

    expect(logger.info).toHaveBeenCalledWith(
      "Seeded access token for some-service",
    );
  });

  it.each(["", "   ", "some-service"])(
    "writes nothing when the value is %o",
    async (value) => {
      config.serviceAccessTokenHash = value;

      await seedAccessToken();

      expect(accessTokens.replaceOne).not.toHaveBeenCalled();
    },
  );

  it("writes nothing when unset", async () => {
    config.serviceAccessTokenHash = undefined;

    await seedAccessToken();

    expect(accessTokens.replaceOne).not.toHaveBeenCalled();
  });

  it("resolves and logs when the write fails, rather than failing startup", async () => {
    const failure = new Error("connection reset by peer");
    failure.code = 6;
    accessTokens.replaceOne.mockRejectedValue(failure);

    await expect(seedAccessToken()).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      { code: 6 },
      "Failed to seed access token for some-service: connection reset by peer",
    );
  });

  it("keeps the token hash out of the log when a write conflicts", async () => {
    const failure = new Error(
      `E11000 duplicate key error collection: fg-gas-backend.access_tokens index: id_1 dup key: { id: "${hash}" }`,
    );
    failure.code = 11000;
    accessTokens.replaceOne.mockRejectedValue(failure);

    await seedAccessToken();

    const [, message] = logger.error.mock.calls[0];

    expect(message).not.toContain(hash);
    expect(message).toContain("<hash>");
  });
});

describe("independent SFD credential seeding", () => {
  const sfdHash = "b".repeat(64);
  let records;
  let accessTokens;
  beforeEach(() => {
    config.serviceAccessTokenHash = `grants-ui:${hash}`;
    config.sfdAccessTokenHash = `single-front-door:${sfdHash}`;
    records = new Map([
      [
        "grants-ui",
        {
          id: hash,
          client: "grants-ui",
          clientId: "grants-ui",
          expiresAt: null,
          seeded: true,
        },
      ],
      [
        "gpa",
        {
          id: "c".repeat(64),
          client: "gpa",
          clientId: "gpa",
          expiresAt: null,
          seeded: true,
        },
      ],
    ]);
    accessTokens = {
      replaceOne: vi.fn(async (filter, replacement, options) => {
        expect(filter).toEqual({ seeded: true, client: replacement.client });
        expect(options).toEqual({ upsert: true });
        const previous = records.get(filter.client);
        records.set(filter.client, replacement);
        return {
          upsertedCount: previous ? 0 : 1,
          modifiedCount: previous?.id === replacement.id ? 0 : 1,
        };
      }),
    };
    db.collection.mockReturnValue(accessTokens);
  });

  it("seeds SFD alongside the existing client without changing GPA", async () => {
    await seedAccessToken();
    expect(records.get("single-front-door")).toEqual({
      id: sfdHash,
      client: "single-front-door",
      clientId: "single-front-door",
      expiresAt: null,
      seeded: true,
    });
    expect(records.get("grants-ui").id).toBe(hash);
    expect(records.get("gpa").id).toBe("c".repeat(64));
  });

  it("seeds SFD when the primary setting is absent", async () => {
    config.serviceAccessTokenHash = undefined;
    await seedAccessToken();
    expect(records.get("single-front-door").id).toBe(sfdHash);
    expect(accessTokens.replaceOne).toHaveBeenCalledTimes(1);
  });

  it("rotates SFD independently and leaves other clients unchanged", async () => {
    await seedAccessToken();
    config.sfdAccessTokenHash = `single-front-door:${"d".repeat(64)}`;
    await seedAccessToken();
    expect(records.get("single-front-door").id).toBe("d".repeat(64));
    expect(records.get("grants-ui").id).toBe(hash);
    expect(records.get("gpa").id).toBe("c".repeat(64));
  });

  it("rotates the primary client without changing SFD", async () => {
    await seedAccessToken();
    config.serviceAccessTokenHash = `grants-ui:${"e".repeat(64)}`;
    await seedAccessToken();
    expect(records.get("grants-ui").id).toBe("e".repeat(64));
    expect(records.get("single-front-door").id).toBe(sfdHash);
  });

  it("skips malformed SFD input and still seeds a valid primary client", async () => {
    config.sfdAccessTokenHash = "malformed";
    config.serviceAccessTokenHash = `grants-ui:${"d".repeat(64)}`;
    await seedAccessToken();
    expect(records.get("grants-ui").id).toBe("d".repeat(64));
    expect(records.has("single-front-door")).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("SFD_ACCESS_TOKEN_HASH"),
    );
  });

  it("deduplicates repeated identical pairs", async () => {
    config.sfdAccessTokenHash = config.serviceAccessTokenHash;
    await seedAccessToken();
    expect(accessTokens.replaceOne).toHaveBeenCalledTimes(1);
    expect(records.get("grants-ui").id).toBe(hash);
  });

  it("rejects a conflicting SFD hash for the primary client", async () => {
    config.sfdAccessTokenHash = `grants-ui:${sfdHash}`;
    await seedAccessToken();
    expect(records.get("grants-ui").id).toBe(hash);
    expect(accessTokens.replaceOne).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("rejects sharing one hash across clients", async () => {
    config.sfdAccessTokenHash = `single-front-door:${hash}`;
    await seedAccessToken();
    expect(records.has("single-front-door")).toBe(false);
    expect(records.get("grants-ui").id).toBe(hash);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("continues SFD seeding when the primary database write fails", async () => {
    accessTokens.replaceOne.mockRejectedValueOnce(new Error("database failed"));
    await expect(seedAccessToken()).resolves.toBeUndefined();
    expect(records.get("single-front-door").id).toBe(sfdHash);
    expect(records.get("grants-ui").id).toBe(hash);
  });

  it("preserves the primary client if the SFD write fails", async () => {
    const replace = accessTokens.replaceOne.getMockImplementation();
    accessTokens.replaceOne.mockImplementation(async (...args) => {
      if (args[0].client === "single-front-door") {
        throw new Error(`duplicate id ${sfdHash}`);
      }
      return replace(...args);
    });
    await expect(seedAccessToken()).resolves.toBeUndefined();
    expect(records.get("grants-ui").id).toBe(hash);
    expect(records.has("single-front-door")).toBe(false);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(sfdHash);
  });
});
