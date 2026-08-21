import Jwt from "@hapi/jwt";

// FGP-1307: caller-token verifier built on @hapi/jwt (the same JWT library the
// other farming-grants services use) rather than a hand-rolled implementation.
// Token parsing and HS256 signature verification are delegated to the library;
// on top of that we apply GAS's warn-only claim policy: expiry is enforced,
// while audience/issuer/subject mismatches are reported as warnings (not
// rejected) so verification can run in a backwards-compatible mode until
// enforcement lands.

const ALGORITHMS = ["HS256"];

const mapSignatureError = (message) =>
  message === "Unsupported algorithm" ? "unsupported-alg" : "bad-signature";

// eslint-disable-next-line complexity
const collectClaimWarnings = (payload, audience) => {
  const warnings = [];
  const { aud } = payload;
  const audienceMatches =
    aud === audience || (Array.isArray(aud) && aud.includes(audience));
  if (!audienceMatches) {
    warnings.push("audience");
  }
  for (const claim of ["iss", "sub"]) {
    if (payload[claim] == null) {
      warnings.push(`missing-${claim}`);
    }
  }
  return warnings;
};

/**
 * Verify a forwarded caller JWT (HS256) using @hapi/jwt.
 * @param {string} token - The raw JWT from the x-encrypted-auth header.
 * @param {string} secret - The shared HS256 secret.
 * @param {{ audience?: string, nowSec?: number }} [options]
 * @returns {{ verified: boolean, reason?: string, payload?: object, warnings?: string[] }}
 */
// eslint-disable-next-line complexity
export const verifyCallerToken = (token, secret, options = {}) => {
  const { audience = "gas", nowSec = Math.floor(Date.now() / 1000) } = options;

  if (!secret) {
    return { verified: false, reason: "no-secret" };
  }

  let artifacts;
  try {
    artifacts = Jwt.token.decode(token);
  } catch {
    return { verified: false, reason: "malformed" };
  }

  try {
    Jwt.token.verifySignature(artifacts, {
      key: secret,
      algorithms: ALGORITHMS,
    });
  } catch (error) {
    return {
      verified: false,
      reason: mapSignatureError(error.message),
      payload: artifacts.decoded?.payload,
    };
  }

  const payload = artifacts.decoded?.payload ?? {};
  if (typeof payload.exp === "number" && payload.exp <= nowSec) {
    return { verified: false, reason: "expired", payload };
  }

  return {
    verified: true,
    payload,
    warnings: collectClaimWarnings(payload, audience),
  };
};
