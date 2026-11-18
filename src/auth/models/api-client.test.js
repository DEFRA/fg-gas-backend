import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { ApiClient } from "./api-client.js";

const NOW = new Date("2026-11-04T10:00:00.000Z");
const EARLIER = new Date("2026-11-01T10:00:00.000Z");
const HASH = "0123456789abcdef".repeat(4);

const row = (fields = {}) => ({
  _id: new ObjectId(),
  clientId: "grants-ui",
  expiresAt: null,
  ...fields,
});

const refusalOf = (call) => {
  try {
    call();
  } catch (error) {
    return {
      statusCode: error.output.statusCode,
      errorCode: error.output.payload.errorCode,
      ...(error.output.payload.active && {
        active: error.output.payload.active,
      }),
    };
  }

  throw new Error("expected a refusal");
};

const issue = (rows, args = {}, clientId = "grants-ui") =>
  ApiClient.fromTokens(clientId, rows).issueToken({
    tokenHash: HASH,
    tokenHint: "a_9-",
    expiresAt: null,
    by: "Ann Operator",
    now: NOW,
    ...args,
  });

describe("ApiClient.issueToken", () => {
  it("issues a token stamped with who made it, when, and its hint", () => {
    expect(issue([row()]).token.toDocument()).toEqual({
      id: HASH,
      clientId: "grants-ui",
      expiresAt: null,
      createdAt: NOW,
      createdBy: "Ann Operator",
      tokenHint: "a_9-",
    });
  });

  it("issues a new client's first token, saying it is new", () => {
    const issued = issue([]);

    expect(issued.newClient).toBe(true);
    expect(issued.token.clientId).toBe("grants-ui");
  });

  it("issues to a client whose name has any row, even a revoked one, saying it is not new", () => {
    expect(
      issue([row({ revokedAt: EARLIER, expiresAt: EARLIER })], {
        confirmed: false,
      }).newClient,
    ).toBe(false);
  });

  it("ignores whether the caller said the client is new", () => {
    expect(issue([row()], { newClient: true }).newClient).toBe(false);
  });

  it("refuses an unconfirmed issue beside active tokens, saying how many", () => {
    expect(
      refusalOf(() =>
        issue([row(), row(), row({ expiresAt: EARLIER })], {
          confirmed: false,
        }),
      ),
    ).toEqual({ statusCode: 409, errorCode: "HAS_ACTIVE", active: 2 });
  });

  it("issues a token that expires on a future date", () => {
    const expiresAt = new Date("2027-01-01T00:00:00.000Z");

    expect(issue([row()], { expiresAt }).token.expiresAt).toBe(expiresAt);
  });

  it.each([
    ["now", NOW],
    ["the past", EARLIER],
    ["not a date", "2027-01-01"],
    ["nothing", undefined],
  ])("refuses an expiry of %s", (_, expiresAt) => {
    expect(refusalOf(() => issue([row()], { expiresAt }))).toEqual({
      statusCode: 400,
      errorCode: "API_TOKEN_INVALID_EXPIRY",
    });
  });

  it("issues beside active tokens when confirmed, as it is by default", () => {
    expect(issue([row(), row(), row()]).token.isActive(NOW)).toBe(true);
  });

  it.each([
    ["uppercase", "Grants-UI"],
    ["a space", "grants ui"],
    ["an underscore", "grants_ui"],
    ["nothing", ""],
    ["65 characters", "a".repeat(65)],
    ["64 hex characters, as a hash", "a".repeat(64)],
  ])("refuses a name with %s", (_, name) => {
    expect(refusalOf(() => issue([], {}, name))).toEqual({
      statusCode: 400,
      errorCode: "API_CLIENT_INVALID_NAME",
    });
  });

  it("accepts lowercase letters, digits and hyphens up to 64 characters", () => {
    const name = `a-1${"b".repeat(61)}`;

    expect(issue([], {}, name).token.clientId).toBe(name);
  });

  it.each([
    ["uppercase hex", HASH.toUpperCase()],
    ["63 characters", HASH.slice(1)],
    ["65 characters", `${HASH}0`],
    ["non-hex", "z".repeat(64)],
    ["nothing", undefined],
  ])("refuses a hash of %s", (_, tokenHash) => {
    expect(refusalOf(() => issue([row()], { tokenHash }))).toEqual({
      statusCode: 400,
      errorCode: "API_TOKEN_INVALID_HASH",
    });
  });

  it.each([
    ["3 characters", "abc"],
    ["5 characters", "abcde"],
    ["a character outside base64url", "ab+c"],
    ["padding", "ab=="],
    ["nothing", undefined],
  ])("refuses a hint of %s", (_, tokenHint) => {
    expect(refusalOf(() => issue([row()], { tokenHint }))).toEqual({
      statusCode: 400,
      errorCode: "API_TOKEN_INVALID_HINT",
    });
  });
});

describe("ApiClient.fromTokens", () => {
  it("keeps only rows that name it by the name rule", () => {
    const client = ApiClient.fromTokens("grants-ui", [
      row(),
      row({ clientId: "Grants_UI" }),
    ]);

    expect(client.tokens).toHaveLength(1);
  });

  it("has no rows under a name that breaks the rule", () => {
    expect(
      ApiClient.fromTokens("Grants_UI", [row({ clientId: "Grants_UI" })])
        .tokens,
    ).toEqual([]);
  });
});
