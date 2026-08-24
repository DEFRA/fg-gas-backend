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

const collectAudienceWarning = (aud, audience) => {
  const audienceMatches =
    aud === audience || (Array.isArray(aud) && aud.includes(audience));
  return audienceMatches ? null : "audience";
};

const collectIssuerWarning = (iss, allowedIssuers) => {
  if (iss == null) {
    return "missing-iss";
  }
  // FGP-1307: fail closed. An empty allow-list means "no issuer is allowed", so
  // any issuer that is not explicitly listed is reported as unknown. The allow-list
  // never silently degrades to "accept any issuer".
  if (!allowedIssuers.includes(iss)) {
    return "unknown-issuer";
  }
  return null;
};

// FGP-1307: report a warning when the expiry claim is absent or not a valid
// numeric timestamp. Replayable tokens (no exp) must be visible during the
// warn-only rollout so they cannot silently pass future enforcement.
const collectExpiryWarning = (exp) => {
  if (exp == null) {
    return "missing-exp";
  }
  if (typeof exp !== "number" || !Number.isFinite(exp)) {
    return "invalid-exp";
  }
  return null;
};

// FGP-1307: the subject identifies the caller. A present-but-empty or non-string
// sub (e.g. "", 0, {}, []) is malformed and must be visible during the warn-only
// rollout, so require a non-empty string rather than only checking for null.
const collectSubjectWarning = (sub) => {
  if (sub == null) {
    return "missing-sub";
  }
  if (typeof sub !== "string" || sub.trim() === "") {
    return "invalid-sub";
  }
  return null;
};

const collectClaimWarnings = (payload, { audience, allowedIssuers }) => {
  const warnings = [
    collectAudienceWarning(payload.aud, audience),
    collectIssuerWarning(payload.iss, allowedIssuers),
    collectExpiryWarning(payload.exp),
    collectSubjectWarning(payload.sub),
  ];
  return warnings.filter(Boolean);
};

/**
 * Verify a forwarded caller JWT (HS256) using @hapi/jwt.
 * @param {string} token - The raw JWT from the x-encrypted-auth header.
 * @param {string} secret - The shared HS256 secret.
 * @param {{ audience?: string, allowedIssuers?: string[], nowSec?: number }} [options]
 * @returns {{ verified: boolean, reason?: string, payload?: object, warnings?: string[] }}
 */
// eslint-disable-next-line complexity
export const verifyCallerToken = (token, secret, options = {}) => {
  const {
    audience = "gas",
    allowedIssuers = [],
    nowSec = Math.floor(Date.now() / 1000),
  } = options;

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
    warnings: collectClaimWarnings(payload, { audience, allowedIssuers }),
  };
};
