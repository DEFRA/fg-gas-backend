import Jwt from "@hapi/jwt";

// FGP-1307: caller-token verifier built on @hapi/jwt (the same JWT library the
// other farming-grants services use) rather than a hand-rolled implementation.
// Token parsing and HS256 signature verification are delegated to the library;
// on top of that we apply GAS's warn-only claim policy: expiry is enforced,
// while audience/issuer/subject mismatches are reported as warnings (not
// rejected) so verification can run in a backwards-compatible mode until
// enforcement lands.

const ALGORITHMS = ["HS256"];

// FGP-1307: resolve the HS256 secret used to verify a caller token from its `kid`
// header.
//
// There is no explicit kid->secret map for the default key: the pairing is
// implicit. `defaultKid` (AGREEMENTS_JWT_DEFAULT_KID) is simply the *label* for
// `defaultSecret` (AGREEMENTS_JWT_SECRET). So a token whose kid equals defaultKid
// verifies with defaultSecret, and a token with no kid at all (e.g. grants-ui,
// intentionally left as-is for now) also falls back to defaultSecret. Only the
// *additional* rotation keys are held as an explicit { kid: secret } map in
// `keyring` (AGREEMENTS_JWT_KEYRING); any kid not equal to defaultKid must be
// present there, otherwise the token cannot be verified. This keeps a single
// pinned default secret working while allowing rotation of extra keys via kid
// overlap.
const resolveSecret = (kid, { defaultSecret, defaultKid, keyring }) => {
  // No kid, or a kid that names the default secret -> use the default secret.
  if (kid == null || kid === defaultKid) {
    return defaultSecret;
  }
  // Any other kid must be explicitly mapped to a secret in the keyring.
  return keyring[kid] ?? null;
};

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
 * @param {string} secret - The default shared HS256 secret (used when the token
 *   carries no kid, or a kid equal to `defaultKid`).
 * @param {{ audience?: string, allowedIssuers?: string[], nowSec?: number, defaultKid?: string, keyring?: object }} [options]
 * @returns {{ verified: boolean, reason?: string, payload?: object, warnings?: string[] }}
 */
// eslint-disable-next-line complexity
export const verifyCallerToken = (token, secret, options = {}) => {
  const {
    audience = "gas",
    allowedIssuers = [],
    nowSec = Math.floor(Date.now() / 1000),
    defaultKid = null,
    keyring = {},
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

  // FGP-1307: select the verifying secret from the token's kid so keys can be
  // rotated via overlap. An unknown kid cannot be verified and is rejected.
  const kid = artifacts.decoded?.header?.kid;
  const resolvedSecret = resolveSecret(kid, {
    defaultSecret: secret,
    defaultKid,
    keyring,
  });
  if (!resolvedSecret) {
    return {
      verified: false,
      reason: "unknown-kid",
      payload: artifacts.decoded?.payload,
    };
  }

  try {
    Jwt.token.verifySignature(artifacts, {
      key: resolvedSecret,
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
