import { config } from "../common/config.js";
import { logger } from "../common/logger.js";
import { db } from "../common/mongo-client.js";

// Scopes reconciliation to records this module owns, so tokens minted with
// scripts/mint-access-token.js are never removed.
const seeded = true;

// The shape config validates SERVICE_ACCESS_TOKEN_HASH against.
const PAIR_PATTERN = /^([a-z0-9-]+):([0-9a-f]{64})$/;

export const parseTokenHash = (value) => {
  const trimmed = (value ?? "").trim();

  if (!trimmed) {
    return null;
  }

  const match = PAIR_PATTERN.exec(trimmed);

  if (!match) {
    // Left unguarded, a missing hash upserts `{ id: null }` and the reconcile
    // below then deletes the client's real token.
    logger.warn(
      "SERVICE_ACCESS_TOKEN_HASH is not a client:sha256hex pair - nothing seeded",
    );
    return null;
  }

  const [, client, id] = match;

  return { client, id };
};

// modifiedCount distinguishes a rotation from a restart that changed nothing;
// upsertedCount alone would claim a replacement on every boot.
const replacedSuffix = (result) =>
  result.modifiedCount > 0 ? ", replacing the previous one" : "";

// A duplicate-key message embeds the offending key, which keeps the hash out of
// logs without losing the diagnostics.
const withoutHashes = (message) =>
  message.replaceAll(/[0-9a-f]{64}/g, "<hash>");

// Issues the configured client's access token, since nobody can insert one by
// hand in a deployed environment. Must run after migrations: the initial
// migration drops access_tokens.
export const seedAccessToken = async () => {
  const entry = parseTokenHash(config.serviceAccessTokenHash);

  if (!entry) {
    return;
  }

  const { client, id } = entry;

  // Serving traffic matters more than issuing a credential. Concurrent boots
  // can collide on the unique index on `id`, and Mongo can blip; either would
  // otherwise take the whole service down on startup. The client gets 401s
  // until the next deploy instead.
  try {
    const accessTokens = db.collection("access_tokens");

    // Keyed by client, not by hash, so a rotation replaces the client's single
    // seeded record in one atomic write. Keying by hash would let two instances
    // booting with different hashes each insert their own and each miss the
    // other's uncommitted record, leaving the superseded credential valid. The
    // partial unique index on {client, seeded} backs that invariant up.
    const result = await accessTokens.replaceOne(
      { seeded, client },
      // auth.js reads clientId, while the index and mint script use client, so
      // both are written until that mismatch is resolved.
      { id, client, clientId: client, expiresAt: null, seeded },
      { upsert: true },
    );

    logger.info(`Seeded access token for ${client}` + replacedSuffix(result));
  } catch (error) {
    logger.error(
      { code: error.code },
      `Failed to seed access token for ${client}: ${withoutHashes(error.message)}`,
    );
  }
};
