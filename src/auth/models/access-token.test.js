import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { AccessToken, LAST_EXPIRY, TOKEN_STATUS } from "./access-token.js";

const NOW = new Date("2026-11-04T10:00:00.000Z");
const EARLIER = new Date("2026-11-01T10:00:00.000Z");
const LATER = new Date("2026-11-05T10:00:00.000Z");
const _id = new ObjectId("6650c1f2a9e4b1d07c20bd91");

const tokenOf = (fields = {}) =>
  AccessToken.fromDocument({ _id, clientId: "grants-ui", ...fields });

const refusalOf = (call) => {
  try {
    call();
  } catch (error) {
    return {
      statusCode: error.output.statusCode,
      errorCode: error.output.payload.errorCode,
    };
  }

  throw new Error("expected a refusal");
};

describe("AccessToken.isActive", () => {
  it("is active with no expiry and no revoke", () => {
    expect(tokenOf({ expiresAt: null }).isActive(NOW)).toBe(true);
  });

  it("is active before its expiry", () => {
    expect(tokenOf({ expiresAt: LATER }).isActive(NOW)).toBe(true);
  });

  it("is not active once its expiry has passed", () => {
    expect(tokenOf({ expiresAt: EARLIER }).isActive(NOW)).toBe(false);
  });

  it("is not active once revoked, whatever its expiry", () => {
    expect(
      tokenOf({ expiresAt: LATER, revokedAt: EARLIER }).isActive(NOW),
    ).toBe(false);
  });
});

describe("AccessToken.status", () => {
  it.each([
    ["ACTIVE", { expiresAt: null }],
    ["ACTIVE", { expiresAt: LATER }],
    ["EXPIRED", { expiresAt: EARLIER }],
    ["REVOKED", { expiresAt: LATER, revokedAt: EARLIER }],
    ["REVOKED", { expiresAt: EARLIER, revokedAt: EARLIER }],
  ])("is %s for %o", (status, fields) => {
    expect(tokenOf(fields).status(NOW)).toBe(TOKEN_STATUS[status]);
    expect(tokenOf(fields).toView({ inUse: false }, NOW).status).toBe(status);
  });
});

describe("AccessToken.fromDocument", () => {
  it("reads a row with none of the new fields", () => {
    expect(tokenOf().toView({ inUse: false })).toEqual({
      tokenId: "6650c1f2a9e4b1d07c20bd91",
      clientId: "grants-ui",
      status: "ACTIVE",
      tokenHint: null,
      createdAt: null,
      createdBy: null,
      expiresAt: null,
      revokedAt: null,
      revokedBy: null,
      inUse: false,
    });
  });

  it.each([
    ["absent", undefined],
    ["null", null],
    ["blank", "  "],
    ["not a string", 42],
    ["outside the name rule", "Grants_UI"],
  ])("reads a row whose clientId is %s as nameless", (_, clientId) => {
    expect(tokenOf({ clientId }).clientId).toBeNull();
  });

  it("names a row by clientId only, never by its legacy client", () => {
    expect(
      AccessToken.fromDocument({ _id, client: "fg-grants-platform-admin" })
        .clientId,
    ).toBeNull();
  });
});

describe("AccessToken.toView", () => {
  it("never carries the hash", () => {
    const view = tokenOf({ id: "a".repeat(64) }).toView({ inUse: true });

    expect(JSON.stringify(view)).not.toContain("a".repeat(64));
    expect(view.inUse).toBe(true);
  });
});

describe("AccessToken.revoke", () => {
  it("records who revoked it and when, and expires it now", () => {
    const token = tokenOf({ expiresAt: null });

    token.revoke({ by: "Ann Operator", now: NOW, callerToken: false });

    expect(token.revokedAt).toBe(NOW);
    expect(token.revokedBy).toBe("Ann Operator");
    expect(token.expiresAt).toBe(NOW);
    expect(token.isActive(NOW)).toBe(false);
  });

  it("refuses the token the request is authenticated with", () => {
    expect(
      refusalOf(() =>
        tokenOf().revoke({ by: "Ann", now: NOW, callerToken: true }),
      ),
    ).toEqual({ statusCode: 409, errorCode: "API_TOKEN_IN_USE" });
  });

  it.each([
    ["revoked", { revokedAt: EARLIER }],
    ["expired", { expiresAt: EARLIER }],
  ])("refuses a token that is %s", (_, fields) => {
    expect(
      refusalOf(() =>
        tokenOf(fields).revoke({ by: "Ann", now: NOW, callerToken: false }),
      ),
    ).toEqual({ statusCode: 409, errorCode: "API_TOKEN_NOT_ACTIVE" });
  });
});

describe("AccessToken expiry at the boundary", () => {
  it("is expired at the very moment its expiry is reached", () => {
    expect(tokenOf({ expiresAt: NOW }).status(NOW)).toBe(TOKEN_STATUS.EXPIRED);
  });
});

describe("AccessToken.changeExpiry", () => {
  it("sets a new expiry on an active token", () => {
    const token = tokenOf({ expiresAt: null });

    expect(
      token.changeExpiry({ expiresAt: LATER, now: NOW, callerToken: false }),
    ).toEqual({
      previousExpiresAt: null,
      revived: false,
    });
    expect(token.expiresAt).toBe(LATER);
  });

  it("revives a revoked token", () => {
    const token = tokenOf({
      revokedAt: EARLIER,
      revokedBy: "Ann",
      expiresAt: EARLIER,
    });

    expect(
      token.changeExpiry({ expiresAt: null, now: NOW, callerToken: false }),
    ).toEqual({ previousExpiresAt: EARLIER, revived: true });
    expect(token).toMatchObject({ revokedAt: null, revokedBy: null });
    expect(token.isActive(NOW)).toBe(true);
  });

  it("gives an expired token a future expiry", () => {
    const token = tokenOf({ expiresAt: EARLIER });

    token.changeExpiry({ expiresAt: LATER, now: NOW, callerToken: false });

    expect(token.isActive(NOW)).toBe(true);
  });

  it.each([
    ["now", NOW],
    ["the past", EARLIER],
    ["after year 9999", new Date("+010000-01-01T00:00:00.000Z")],
  ])("refuses an expiry of %s", (_, expiresAt) => {
    expect(
      refusalOf(() =>
        tokenOf().changeExpiry({ expiresAt, now: NOW, callerToken: false }),
      ),
    ).toEqual({ statusCode: 400, errorCode: "API_TOKEN_INVALID_EXPIRY" });
  });

  it("refuses to stop the token the request calls with", () => {
    expect(
      refusalOf(() =>
        tokenOf().changeExpiry({
          expiresAt: EARLIER,
          now: NOW,
          callerToken: true,
        }),
      ),
    ).toEqual({ statusCode: 409, errorCode: "API_TOKEN_IN_USE" });
  });

  // Its format is checked first, so a malformed date is never taken for an
  // attempt to stop the token.
  it.each([
    ["not a date", "soon"],
    ["after year 9999", new Date("+010000-01-01T00:00:00.000Z")],
  ])(
    "refuses an expiry %s as invalid, even on the caller's own token",
    (_, expiresAt) => {
      expect(
        refusalOf(() =>
          tokenOf().changeExpiry({ expiresAt, now: NOW, callerToken: true }),
        ),
      ).toEqual({ statusCode: 400, errorCode: "API_TOKEN_INVALID_EXPIRY" });
    },
  );

  it("accepts the last expiry a listing can show", () => {
    const token = tokenOf();

    token.changeExpiry({
      expiresAt: LAST_EXPIRY,
      now: NOW,
      callerToken: false,
    });

    expect(token.expiresAt).toEqual(LAST_EXPIRY);
  });

  it("lets the token the request calls with be given a later expiry", () => {
    expect(() =>
      tokenOf().changeExpiry({ expiresAt: LATER, now: NOW, callerToken: true }),
    ).not.toThrow();
  });
});

describe("AccessToken.rotate", () => {
  const HASH = "b".repeat(64);
  const DAY_MS = 24 * 60 * 60 * 1000;

  const rotate = (fields, args = {}) => {
    const token = tokenOf(fields);
    const successor = token.rotate({
      tokenHash: HASH,
      tokenHint: "wxyz",
      keepOld: "24h",
      by: "Ann",
      now: NOW,
      callerToken: false,
      ...args,
    });

    return { token, successor };
  };

  it.each([
    ["none", NOW],
    ["24h", new Date("2026-11-05T23:59:59.000Z")],
    ["7d", new Date("2026-11-11T23:59:59.000Z")],
  ])(
    "keeps a never-expiring token for %s, and passes never on",
    (keepOld, until) => {
      const { token, successor } = rotate({ expiresAt: null }, { keepOld });

      expect(token.expiresAt).toEqual(until);
      expect(successor.toDocument()).toEqual({
        id: HASH,
        clientId: "grants-ui",
        client: "grants-ui",
        expiresAt: null,
        createdAt: NOW,
        createdBy: "Ann",
        tokenHint: "wxyz",
      });
    },
  );

  it("never keeps the old token past its own expiry, and gives it to the new one", () => {
    const soon = new Date(NOW.getTime() + 60 * 1000);
    const { token, successor } = rotate({ expiresAt: soon }, { keepOld: "7d" });

    expect(token.expiresAt).toBe(soon);
    expect(successor.expiresAt).toBe(soon);
  });

  it("keeps an expiry that comes before the end of the overlap's UK day", () => {
    const evening = new Date(NOW.getTime() + DAY_MS + 12 * 60 * 60 * 1000);
    const { token } = rotate({ expiresAt: evening }, { keepOld: "24h" });

    expect(token.expiresAt).toBe(evening);
  });

  it.each([
    ["24h", "2026-10-25T23:30:00.000Z", "2026-10-26T23:59:59.000Z"],
    ["24h", "2026-10-24T23:30:00.000Z", "2026-10-25T23:59:59.000Z"],
    ["7d", "2026-10-20T22:30:00.000Z", "2026-10-27T23:59:59.000Z"],
    ["24h", "2026-03-28T12:00:00.000Z", "2026-03-29T22:59:59.000Z"],
    ["24h", "2026-03-28T23:30:00.000Z", "2026-03-30T22:59:59.000Z"],
    ["7d", "2026-03-24T12:00:00.000Z", "2026-03-31T22:59:59.000Z"],
    ["24h", "2026-07-01T23:30:00.000Z", "2026-07-03T22:59:59.000Z"],
  ])(
    "with keepOld %s at %s, ends the old token at 23:59:59 UK time, %s",
    (keepOld, now, until) => {
      const { token } = rotate(
        { expiresAt: null },
        { keepOld, now: new Date(now) },
      );

      expect(token.expiresAt).toEqual(new Date(until));
    },
  );

  it.each([
    ["revoked", { revokedAt: EARLIER, expiresAt: EARLIER }],
    ["expired", { expiresAt: EARLIER }],
  ])("refuses a token that is %s", (_, fields) => {
    expect(refusalOf(() => rotate(fields))).toEqual({
      statusCode: 409,
      errorCode: "API_TOKEN_NOT_ACTIVE",
    });
  });

  it("refuses to end the token the request calls with at once", () => {
    expect(
      refusalOf(() => rotate({}, { keepOld: "none", callerToken: true })),
    ).toEqual({ statusCode: 409, errorCode: "API_TOKEN_IN_USE" });
  });

  it("rotates the token the request calls with, given an overlap", () => {
    expect(() =>
      rotate({}, { keepOld: "24h", callerToken: true }),
    ).not.toThrow();
  });

  it("refuses an invalid hash for the new token", () => {
    expect(refusalOf(() => rotate({}, { tokenHash: "nope" }))).toEqual({
      statusCode: 400,
      errorCode: "API_TOKEN_INVALID_HASH",
    });
  });
});

describe("AccessToken.assertDeletable", () => {
  it.each([
    ["revoked", { revokedAt: EARLIER, expiresAt: EARLIER }],
    ["expired", { expiresAt: EARLIER }],
  ])("allows a token that is %s", (_, fields) => {
    expect(() => tokenOf(fields).assertDeletable(NOW)).not.toThrow();
  });

  it("refuses an active token", () => {
    expect(refusalOf(() => tokenOf().assertDeletable(NOW))).toEqual({
      statusCode: 409,
      errorCode: "API_TOKEN_ACTIVE",
    });
  });
});
