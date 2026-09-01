import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// FGP-1307: exercise the caller-token config mapping and the keyring parser.
// config.js validates process.env on import, so each case sets the relevant
// env vars, resets the module registry, and re-imports to observe the result.

const CALLER_TOKEN_ENV_KEYS = [
  "AGREEMENTS_JWT_DEFAULT_KID",
  "AGREEMENTS_JWT_KEYRING",
  "CALLER_TOKEN_ENFORCE",
];

const loadCallerTokenConfig = async () => {
  vi.resetModules();
  const { config } = await import("./config.js");
  return config.callerToken;
};

describe("config caller-token (FGP-1307)", () => {
  const saved = {};

  beforeEach(() => {
    for (const key of CALLER_TOKEN_ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of CALLER_TOKEN_ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  it("applies secure defaults when the env vars are unset", async () => {
    const callerToken = await loadCallerTokenConfig();

    expect(callerToken.defaultKid).toBe("agreements-hs256-1");
    expect(callerToken.keyring).toEqual({});
    expect(callerToken.enforce).toBe(false);
  });

  it("uses a custom default kid when provided", async () => {
    process.env.AGREEMENTS_JWT_DEFAULT_KID = "agreements-hs256-9";

    const callerToken = await loadCallerTokenConfig();

    expect(callerToken.defaultKid).toBe("agreements-hs256-9");
  });

  it("turns enforcement on when CALLER_TOKEN_ENFORCE is true", async () => {
    process.env.CALLER_TOKEN_ENFORCE = "true";

    const callerToken = await loadCallerTokenConfig();

    expect(callerToken.enforce).toBe(true);
  });

  it("parses a valid JSON object keyring", async () => {
    process.env.AGREEMENTS_JWT_KEYRING = JSON.stringify({
      "agreements-hs256-2": "rotated-secret",
    });

    const callerToken = await loadCallerTokenConfig();

    expect(callerToken.keyring).toEqual({
      "agreements-hs256-2": "rotated-secret",
    });
  });

  it("fails closed to an empty keyring for malformed JSON", async () => {
    process.env.AGREEMENTS_JWT_KEYRING = "{not-json";

    const callerToken = await loadCallerTokenConfig();

    expect(callerToken.keyring).toEqual({});
  });

  it("fails closed to an empty keyring when the JSON is an array", async () => {
    process.env.AGREEMENTS_JWT_KEYRING = JSON.stringify(["not", "an", "object"]);

    const callerToken = await loadCallerTokenConfig();

    expect(callerToken.keyring).toEqual({});
  });

  it("fails closed to an empty keyring when the JSON is a primitive", async () => {
    process.env.AGREEMENTS_JWT_KEYRING = "42";

    const callerToken = await loadCallerTokenConfig();

    expect(callerToken.keyring).toEqual({});
  });

  it("treats an empty-string keyring as an empty keyring", async () => {
    process.env.AGREEMENTS_JWT_KEYRING = "";

    const callerToken = await loadCallerTokenConfig();

    expect(callerToken.keyring).toEqual({});
  });

  it("exposes the fixed producer issuer allow-list", async () => {
    const callerToken = await loadCallerTokenConfig();

    expect(callerToken.allowedIssuers).toEqual([
      "grants-ui",
      "fg-cw-frontend",
      "agreements-pdf",
    ]);
  });
});
