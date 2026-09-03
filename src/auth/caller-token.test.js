import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyCallerToken } from "./caller-token.js";

const SECRET = "test-shared-secret";

const base64url = (input) =>
  Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const sign = (headerB64, payloadB64, secret) =>
  crypto
    .createHmac("sha256", secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const makeToken = (payload, { secret = SECRET, alg = "HS256" } = {}) => {
  const headerB64 = base64url(JSON.stringify({ alg, typ: "JWT" }));
  const payloadB64 = base64url(JSON.stringify(payload));
  return `${headerB64}.${payloadB64}.${sign(headerB64, payloadB64, secret)}`;
};

const nowSec = Math.floor(Date.now() / 1000);

const ALLOWED_ISSUERS = ["grants-ui", "fg-cw-frontend", "agreements-pdf"];

const validPayload = {
  iss: "grants-ui",
  aud: ["agreements-ui", "gas"],
  sub: "123456789",
  exp: nowSec + 300,
};

const verify = (payload, opts = {}) =>
  verifyCallerToken(makeToken(payload), SECRET, {
    nowSec,
    allowedIssuers: ALLOWED_ISSUERS,
    ...opts,
  });

describe("verifyCallerToken", () => {
  it("verifies a well-formed, correctly-signed, unexpired token targeting gas", () => {
    const result = verify(validPayload);

    expect(result.verified).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.payload.sub).toBe("123456789");
  });

  it("accepts a string audience equal to gas", () => {
    const result = verify({ ...validPayload, aud: "gas" });

    expect(result.verified).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("reports no-secret when the shared secret is not configured", () => {
    const result = verifyCallerToken(makeToken(validPayload), undefined, {
      nowSec,
    });

    expect(result).toEqual({ verified: false, reason: "no-secret" });
  });

  it("reports malformed tokens", () => {
    expect(verifyCallerToken("not-a-jwt", SECRET).reason).toBe("malformed");
    expect(verifyCallerToken("a.b", SECRET).reason).toBe("malformed");
    expect(verifyCallerToken(undefined, SECRET).reason).toBe("malformed");
  });

  it("rejects a token signed with the wrong secret", () => {
    const result = verifyCallerToken(
      makeToken(validPayload, { secret: "wrong-secret" }),
      SECRET,
      { nowSec },
    );

    expect(result.verified).toBe(false);
    expect(result.reason).toBe("bad-signature");
  });

  it("rejects an expired token", () => {
    const result = verify({ ...validPayload, exp: nowSec - 1 });

    expect(result.verified).toBe(false);
    expect(result.reason).toBe("expired");
  });

  it("rejects an unsupported algorithm", () => {
    const result = verifyCallerToken(
      makeToken(validPayload, { alg: "none" }),
      SECRET,
      { nowSec },
    );

    expect(result.verified).toBe(false);
    expect(result.reason).toBe("unsupported-alg");
  });

  it("verifies but warns when the audience excludes gas", () => {
    const result = verify({ ...validPayload, aud: ["agreements-ui"] });

    expect(result.verified).toBe(true);
    expect(result.warnings).toContain("audience");
  });

  it("verifies but warns when iss and sub are missing (legacy token shape)", () => {
    const result = verify({ aud: "gas", exp: nowSec + 300 });

    expect(result.verified).toBe(true);
    expect(result.warnings).toEqual(
      expect.arrayContaining(["missing-iss", "missing-sub"]),
    );
  });

  it.each([
    ["an empty string", ""],
    ["a whitespace-only string", "   "],
    ["a number", 0],
    ["an object", {}],
    ["an array", []],
  ])("verifies but warns when sub is %s (malformed subject)", (_label, sub) => {
    const result = verify({ ...validPayload, sub });

    expect(result.verified).toBe(true);
    expect(result.warnings).toContain("invalid-sub");
    expect(result.warnings).not.toContain("missing-sub");
  });

  it("does not warn on sub for a valid non-empty string subject", () => {
    const result = verify({ ...validPayload, sub: "123456789" });

    expect(result.verified).toBe(true);
    expect(result.warnings).not.toContain("invalid-sub");
    expect(result.warnings).not.toContain("missing-sub");
  });

  it("verifies but warns when exp is missing (replayable token)", () => {
    const result = verify({ iss: "grants-ui", aud: "gas", sub: "1" });

    expect(result.verified).toBe(true);
    expect(result.warnings).toContain("missing-exp");
  });

  it("verifies but warns when exp is not a numeric timestamp", () => {
    const result = verify({ ...validPayload, exp: "soon" });

    expect(result.verified).toBe(true);
    expect(result.warnings).toContain("invalid-exp");
  });

  describe("issuer identity", () => {
    it.each([
      ["applicant", "grants-ui"],
      ["caseworker", "fg-cw-frontend"],
      ["PDF", "agreements-pdf"],
    ])("accepts the %s issuer (%s) without warning", (_caller, iss) => {
      const result = verify({ ...validPayload, iss });

      expect(result.verified).toBe(true);
      expect(result.warnings).toEqual([]);
    });

    it("verifies but warns when the issuer is not an allowed producer", () => {
      const result = verify({ ...validPayload, iss: "evil-service" });

      expect(result.verified).toBe(true);
      expect(result.warnings).toContain("unknown-issuer");
    });

    it("fails closed and warns for any issuer when the allow-list is empty", () => {
      const result = verify(
        { ...validPayload, iss: "anything" },
        { allowedIssuers: [] },
      );

      expect(result.verified).toBe(true);
      expect(result.warnings).toContain("unknown-issuer");
    });
  });

  describe("kid key selection (FGP-1307)", () => {
    const makeTokenWithKid = (payload, kid, secret = SECRET) => {
      const headerB64 = base64url(
        JSON.stringify({ alg: "HS256", typ: "JWT", kid }),
      );
      const payloadB64 = base64url(JSON.stringify(payload));
      return `${headerB64}.${payloadB64}.${sign(headerB64, payloadB64, secret)}`;
    };

    it("uses the default secret when the token carries no kid", () => {
      const result = verifyCallerToken(makeToken(validPayload), SECRET, {
        nowSec,
        allowedIssuers: ALLOWED_ISSUERS,
        defaultKid: "agreements-hs256-1",
        keyring: {},
      });

      expect(result.verified).toBe(true);
    });

    it("uses the default secret when the kid matches the default kid", () => {
      const token = makeTokenWithKid(validPayload, "agreements-hs256-1");
      const result = verifyCallerToken(token, SECRET, {
        nowSec,
        allowedIssuers: ALLOWED_ISSUERS,
        defaultKid: "agreements-hs256-1",
        keyring: {},
      });

      expect(result.verified).toBe(true);
    });

    it("verifies a rotated kid using the keyring secret", () => {
      const rotatedSecret = "rotated-secret";
      const token = makeTokenWithKid(
        validPayload,
        "agreements-hs256-2",
        rotatedSecret,
      );
      const result = verifyCallerToken(token, SECRET, {
        nowSec,
        allowedIssuers: ALLOWED_ISSUERS,
        defaultKid: "agreements-hs256-1",
        keyring: { "agreements-hs256-2": rotatedSecret },
      });

      expect(result.verified).toBe(true);
    });

    it("rejects a token whose kid is not in the keyring", () => {
      const token = makeTokenWithKid(validPayload, "unknown-kid");
      const result = verifyCallerToken(token, SECRET, {
        nowSec,
        allowedIssuers: ALLOWED_ISSUERS,
        defaultKid: "agreements-hs256-1",
        keyring: {},
      });

      expect(result.verified).toBe(false);
      expect(result.reason).toBe("unknown-kid");
    });
  });
});
