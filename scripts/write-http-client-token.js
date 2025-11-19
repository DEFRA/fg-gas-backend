/**
 * Script: write-http-client-token.js
 *
 * Description
 * -----------
 * Mints a new service token (via `scripts/mint-access-token.js`) and writes the
 * RAW bearer token into `http-client.private.env.json` for the specified
 * environment. This makes it easy to use the token in `api.http` requests.
 *
 * Environment
 * -----------
 * - For local usage, the underlying mint script expects:
 *   - MONGO_URI        Connection string to MongoDB (e.g. mongodb://localhost:27017)
 *   - MONGO_DATABASE   Target database name (e.g. fg-gas-backend)
 *   These are only required if you want the hashed token inserted into Mongo.
 *
 * Arguments
 * ---------
 * - argv[2] envName     Required. The profile key in `http-client.private.env.json`
 *                       to update (e.g. local, dev, test).
 * - argv[3] clientName  Optional. Defaults to "grants-ui".
 * - argv[4] expiresAt   Optional ISO date string (e.g. 2026-01-31T23:59:59Z).
 *                       Use `null` or omit to create a non-expiring token.
 *
 * Usage
 * -----
 * node scripts/write-http-client-token.js local http-client 2099-01-01T00:00:00Z
 * node scripts/write-http-client-token.js dev   grants-ui   2026-01-01T00:00:00Z
 *
 * What it does
 * ------------
 * 1) Runs the mint script to create a new token. The mint script:
 *    - Inserts the hashed token in Mongo when DB vars are set, otherwise prints
 *      the hash for manual insertion.
 *    - Prints the RAW token last to stdout (shown once).
 * 2) Parses the RAW token and writes it to `http-client.private.env.json` as:
 *    { "<envName>": { "serviceToken": "<RAW_TOKEN>" } }
 *
 * Output
 * ------
 * - Confirms the updated file and env key.
 * - Reminder that `http-client.private.env.json` must not be committed.
 *
 * Notes
 * -----
 * - Requires `scripts/mint-access-token.js` (present in this repo) and that it
 *   prints the raw token on the last line of its output.
 * - The RAW token is sensitive. Store it securely; do not commit it to source
 *   control. The `http-client.private.env.json` file should be git-ignored.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const [, , envName, clientName = "grants-ui", expires = null] = process.argv;

if (!envName) {
  console.error(
    "Usage: node scripts/write-http-client-token.js <envName> [clientName] [expiresISO]",
  );
  process.exit(1);
}

const repoRoot = resolve(__dirname, "..");
const privateEnvPath = resolve(repoRoot, "http-client.private.env.json");
const mintScript = resolve(repoRoot, "scripts/mint-access-token.js");

// 1) Mint a new token (raw). The mint script will insert the hash into Mongo.
const args = [mintScript, clientName];
if (expires !== null) args.push(expires);

const mint = spawnSync("node", args, { env: process.env, encoding: "utf8" });
if (mint.status !== 0) {
  console.error(mint.stdout);
  console.error(mint.stderr);
  process.exit(mint.status ?? 1);
}

// Extract the raw token. The mint script prints it last; also validate UUID v4 shape.
const lines = mint.stdout
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter(Boolean);
const rawToken = lines[lines.length - 1];
const uuidLike =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (!rawToken || !uuidLike.test(rawToken)) {
  console.error(
    "Could not parse raw token from mint-access-token output. Last line was:\n",
    rawToken,
  );
  process.exit(1);
}

// 2) Load or initialise the private env JSON and set the token for the env.
let json = {};
if (existsSync(privateEnvPath)) {
  try {
    json = JSON.parse(readFileSync(privateEnvPath, "utf8"));
  } catch {
    json = {};
  }
}

if (!json[envName]) json[envName] = {};
json[envName].serviceToken = rawToken;

// 3) Write back to disk with pretty formatting.
writeFileSync(privateEnvPath, JSON.stringify(json, null, 2));

console.log(`Updated ${privateEnvPath} -> [${envName}].serviceToken`);
console.log(
  "Note: Do not commit http-client.private.env.json; it should be git-ignored.",
);
