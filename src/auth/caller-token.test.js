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

const validPayload = {
  iss: "grants-ui",
  aud: ["agreements-ui", "gas"],
  sub: "123456789",
  exp: nowSec + 300,
};

describe("verifyCallerToken", () => {
  it("verifies a well-formed, correctly-signed, unexpired token targeting gas", () => {
    const result = verifyCallerToken(makeToken(validPayload), SECRET, { nowSec });

    expect(result.verified).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.payload.sub).toBe("123456789");
  });

  it("accepts a string audience equal to gas", () => {
    const result = verifyCallerToken(
      makeToken({ ...validPayload, aud: "gas" }),
      SECRET,
      { nowSec },
    );

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
    const result = verifyCallerToken(
      makeToken({ ...validPayload, exp: nowSec - 1 }),
      SECRET,
      { nowSec },
    );

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
    const result = verifyCallerToken(
      makeToken({ ...validPayload, aud: ["agreements-ui"] }),
      SECRET,
      { nowSec },
    );

    expect(result.verified).toBe(true);
    expect(result.warnings).toContain("audience");
  });

  it("verifies but warns when iss and sub are missing (legacy token shape)", () => {
    const result = verifyCallerToken(
      makeToken({ aud: "gas", exp: nowSec + 300 }),
      SECRET,
      { nowSec },
    );

    expect(result.verified).toBe(true);
    expect(result.warnings).toEqual(
      expect.arrayContaining(["missing-iss", "missing-sub"]),
    );
  });

  it("accepts a legacy token with no exp claim (backwards-compatible)", () => {
    const result = verifyCallerToken(
      makeToken({ iss: "grants-ui", aud: "gas", sub: "1" }),
      SECRET,
      { nowSec },
    );

    expect(result.verified).toBe(true);
    expect(result.warnings).toEqual([]);
  });
});
