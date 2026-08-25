/**
 * Script: new-service-credential.js
 *
 * Description
 * -----------
 * Generates a service credential pair for a client that GAS seeds at boot:
 * a raw UUIDv4 bearer token, and the SHA-256 hash GAS matches it against.
 *
 * Unlike scripts/mint-access-token.js this touches no database - deployed
 * environments give nobody direct Mongo access, so GAS writes the record itself
 * from the hash in SERVICE_ACCESS_TOKEN_HASH. That means this can be run
 * anywhere, including offline, and needs no connection details.
 *
 * Hash by hand at your peril: `echo "$token" | sha256sum` hashes a trailing
 * newline and silently produces a value GAS will never match.
 *
 * Arguments
 * ---------
 * - argv[2] clientName  Required. The calling service, e.g. its CDP service name.
 *
 * Usage
 * -----
 * npm run token:new -- <client-name>
 *
 * Then, in the CDP portal for the target environment:
 * - set the printed `client:hash` pair as fg-gas-backend's
 *   SERVICE_ACCESS_TOKEN_HASH secret
 * - give the raw token to the calling service as its own secret
 * - redeploy both
 *
 * Generate a separate pair per environment - never reuse one across them.
 */
import crypto from "node:crypto";

const clientName = process.argv[2];

if (!clientName) {
  console.error("Usage: npm run token:new -- <client-name>");
  process.exit(1);
}

if (!/^[a-z0-9-]+$/.test(clientName)) {
  console.error(
    `Invalid client name "${clientName}" - use lowercase letters, digits and hyphens`,
  );
  process.exit(1);
}

const raw = crypto.randomUUID();
const hash = crypto.createHash("sha256").update(raw, "utf8").digest("hex");

console.log(`Service credential for: ${clientName}`);
console.log("");
console.log("Set as fg-gas-backend's SERVICE_ACCESS_TOKEN_HASH secret:");
console.log(`${clientName}:${hash}`);
console.log("");
console.log(
  "Raw token - secret on the calling service (shown once, store now):",
);
console.log(raw);
