/**
 * Script: mint-access-token.js
 *
 * Description
 * -----------
 * Mints a new bearer access token for the GAS backend and (optionally) stores
 * the SHA-256 hash of that token in the MongoDB `access_tokens` collection.
 * The raw bearer token is printed once to stdout — copy it and store it
 * securely. Anyone with this token can authenticate as the specified client.
 *
 * Environment
 * -----------
 * - MONGO_URI        Connection string to MongoDB. If provided (together with
 *                    MONGO_DATABASE), the script will insert the hashed token
 *                    into the database. Example: mongodb://localhost:27017
 * - MONGO_DATABASE   Target database name (e.g. fg-gas-backend)
 *
 * Arguments
 * ---------
 * - argv[2] clientName  Optional. Defaults to "grants-ui".
 * - argv[3] expiresAt   Optional ISO date string (e.g. 2026-01-31T23:59:59Z).
 *                       Use `null` or omit to create a non-expiring token.
 *
 * Usage
 * -----
 * Insert hashed token automatically (recommended for local dev)
 *
 * Ensure `.env` contains MONGO_URI="mongodb://localhost:27017"
 * MONGO_DATABASE=fg-gas-backend
 *
 * `node --env-file=.env scripts/mint-access-token.js grants-ui 2026-01-31T23:59:59Z`
 *
 * Create token without DB insert (prints the hash so you can add it manually)
 *
 * `node scripts/mint-access-token.js grants-ui`
 *
 * Output
 * ------
 * - Confirmation and context (client, expiry).
 * - If DB vars are set: a note that the hashed token was inserted.
 * - If DB vars are NOT set: the SHA-256 hash to insert manually into
 *   `access_tokens.id`.
 * - The raw bearer token (shown once) — store this securely.
 *
 * Notes
 * -----
 * - The database document shape:
 *   { id: <sha256 hex>, client: <string>, expiresAt: <Date|null> }
 * - To use the token in HTTP client requests, set the Authorization header:
 *   Authorization: Bearer <RAW_TOKEN>
 */
import { MongoClient } from "mongodb";
import crypto from "node:crypto";

const mongoUri = process.env.MONGO_URI;
const dbName = process.env.MONGO_DATABASE;
const clientName = process.argv[2] || "grants-ui";
const expires = process.argv[3] || null; // ISO date string or null

const sha256Hex = (s) =>
  crypto.createHash("sha256").update(s, "utf8").digest("hex");

function uuidv4() {
  const buf = crypto.randomBytes(16);
  buf[6] = (buf[6] & 0x0f) | 0x40;
  buf[8] = (buf[8] & 0x3f) | 0x80;
  const h = [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

async function main() {
  const raw = uuidv4();
  const hash = sha256Hex(raw);

  if (mongoUri && dbName) {
    const mongo = await MongoClient.connect(mongoUri);
    const db = mongo.db(dbName);
    const col = db.collection("access_tokens");

    const doc = {
      id: hash,
      client: clientName,
      expiresAt: expires ? new Date(expires) : null,
    };

    await col.insertOne(doc);
    await mongo.close();
  }

  console.log("✅ GAS Access Token created");
  console.log("Client:", clientName);
  console.log("ExpiresAt:", expires || "null");
  if (mongoUri && dbName) {
    console.log("Hashed token added to access_tokens collection");
  } else {
    console.log(
      "Hashed token to insert manually into access_tokens collection:",
    );
    console.log(hash);
  }
  console.log("Bearer token (save securely, shown once):");
  console.log(raw);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
