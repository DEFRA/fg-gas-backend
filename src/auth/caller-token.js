import crypto from "node:crypto";

// FGP-1307: minimal HS256 caller-token verifier. GAS has no JWT library and
// this is deliberately dependency-free. It verifies the signature and expiry of
// the caller token forwarded by Agreements UI, and reports (but does not
// enforce) audience/issuer/subject claims so verification can run in a
// backwards-compatible ("warn-only") mode until enforcement lands.

const decodeSegment = (segment) => {
  const padLength = segment.length % 4 === 0 ? 0 : 4 - (segment.length % 4);
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(padLength);
  return Buffer.from(base64, "base64");
};

const parseJson = (segment) => {
  try {
    return JSON.parse(decodeSegment(segment).toString("utf8"));
  } catch {
    return null;
  }
};

const signaturesMatch = (expected, provided) =>
  expected.length === provided.length &&
  crypto.timingSafeEqual(expected, provided);

// eslint-disable-next-line complexity
const decodeToken = (token) => {
  if (typeof token !== "string" || token.split(".").length !== 3) {
    return { reason: "malformed" };
  }

  const [headerB64, payloadB64, signatureB64] = token.split(".");
  const header = parseJson(headerB64);
  const payload = parseJson(payloadB64);

  if (!header || !payload) {
    return { reason: "malformed" };
  }

  return { header, payload, headerB64, payloadB64, signatureB64 };
};

const checkSignature = ({ header, headerB64, payloadB64, signatureB64 }, secret) => {
  if (header.alg !== "HS256") {
    return "unsupported-alg";
  }

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest();

  if (!signaturesMatch(expectedSignature, decodeSegment(signatureB64))) {
    return "bad-signature";
  }

  return null;
};

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
 * Verify a forwarded caller JWT (HS256).
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

  const decoded = decodeToken(token);
  if (decoded.reason) {
    return { verified: false, reason: decoded.reason };
  }

  const signatureError = checkSignature(decoded, secret);
  if (signatureError) {
    return { verified: false, reason: signatureError, payload: decoded.payload };
  }

  const { payload } = decoded;
  if (typeof payload.exp === "number" && payload.exp <= nowSec) {
    return { verified: false, reason: "expired", payload };
  }

  return { verified: true, payload, warnings: collectClaimWarnings(payload, audience) };
};
