import Boom from "@hapi/boom";
import { endOfUkDay } from "../../common/end-of-uk-day.js";

export const refusal = (error, errorCode) => {
  error.output.payload.errorCode = errorCode;
  return error;
};

export const TOKEN_STATUS = {
  ACTIVE: "ACTIVE",
  EXPIRED: "EXPIRED",
  REVOKED: "REVOKED",
};

const orNull = (value) => value ?? null;

// A name of 64 hex characters reads as a hash, which no listing may carry.
export const CLIENT_NAME = /^(?![0-9a-f]{64}$)[a-z0-9-]{1,64}$/;

export const isClientName = (value) =>
  typeof value === "string" && CLIENT_NAME.test(value);

// A clientId that breaks the name rule names nobody, whatever the legacy
// `client` says: its row is listed with no name until a migration names it.
const nameOf = (value) => (isClientName(value) ? value : null);

const isExpired = (expiresAt, now) => Boolean(expiresAt && now >= expiresAt);

const TOKEN_HASH = /^[0-9a-f]{64}$/;
// The last four characters of a base64url token, as the admin generates it.
const TOKEN_HINT = /^[A-Za-z0-9_-]{4}$/;

const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS_PER_WEEK = 7;
const WEEK_MS = DAYS_PER_WEEK * DAY_MS;
// How long a rotated token keeps working beside its successor, at least: an
// overlap runs on to the end of the UK day it reaches.
export const KEEP_OLD = {
  none: 0,
  "24h": DAY_MS,
  "7d": WEEK_MS,
};

const overlapEnd = (keepOld, now) =>
  KEEP_OLD[keepOld] === 0
    ? now
    : endOfUkDay(new Date(now.getTime() + KEEP_OLD[keepOld]));

const matches = (pattern, value) =>
  typeof value === "string" && pattern.test(value);

// Neither message quotes the value.
const assertTokenHash = (tokenHash) => {
  if (!matches(TOKEN_HASH, tokenHash)) {
    throw refusal(
      Boom.badRequest("A token hash is 64 lowercase hex characters"),
      "API_TOKEN_INVALID_HASH",
    );
  }
};

const assertTokenHint = (tokenHint) => {
  if (!matches(TOKEN_HINT, tokenHint)) {
    throw refusal(
      Boom.badRequest("A token hint is the token's last 4 characters"),
      "API_TOKEN_INVALID_HINT",
    );
  }
};

// The last a listing can show: relaxed Extended JSON writes a date as an ISO
// string only up to year 9999.
export const LAST_EXPIRY = new Date("9999-12-31T23:59:59.999Z");

// Null is never.
const isExpiry = (expiresAt) =>
  expiresAt === null || (expiresAt instanceof Date && expiresAt <= LAST_EXPIRY);

const isFuture = (expiresAt, now) =>
  isExpiry(expiresAt) && (expiresAt === null || expiresAt > now);

const invalidExpiry = () =>
  refusal(
    Boom.badRequest("An expiry is a future date up to year 9999, or none"),
    "API_TOKEN_INVALID_EXPIRY",
  );

const assertExpiry = (expiresAt, now) => {
  if (!isFuture(expiresAt, now)) {
    throw invalidExpiry();
  }
};

const tokenInUse = (message) =>
  refusal(Boom.conflict(message), "API_TOKEN_IN_USE");

const notActive = (message) =>
  refusal(Boom.conflict(message), "API_TOKEN_NOT_ACTIVE");

const earlier = (expiresAt, cutOff) =>
  expiresAt && expiresAt < cutOff ? expiresAt : cutOff;

export class AccessToken {
  constructor(fields) {
    this._id = fields._id;
    this.id = fields.id;
    this.clientId = nameOf(fields.clientId);
    this.expiresAt = orNull(fields.expiresAt);
    this.createdAt = orNull(fields.createdAt);
    this.createdBy = orNull(fields.createdBy);
    this.revokedAt = orNull(fields.revokedAt);
    this.revokedBy = orNull(fields.revokedBy);
    this.tokenHint = orNull(fields.tokenHint);
  }

  static issue({ clientId, tokenHash, tokenHint, expiresAt, by, now }) {
    assertTokenHash(tokenHash);
    assertTokenHint(tokenHint);
    assertExpiry(expiresAt, now);

    return new AccessToken({
      id: tokenHash,
      clientId,
      expiresAt,
      createdAt: now,
      createdBy: by,
      tokenHint,
    });
  }

  // Rows written before FGP-1572 have none of the new fields.
  static fromDocument(document) {
    return new AccessToken(document);
  }

  get tokenId() {
    return this._id.toHexString();
  }

  // Derived on every read, never stored.
  status(now) {
    if (this.revokedAt) {
      return TOKEN_STATUS.REVOKED;
    }

    return isExpired(this.expiresAt, now)
      ? TOKEN_STATUS.EXPIRED
      : TOKEN_STATUS.ACTIVE;
  }

  isActive(now) {
    return this.status(now) === TOKEN_STATUS.ACTIVE;
  }

  // Moving `expiresAt` to now is what stops the token: auth needs no change,
  // and an older image still refuses it.
  revoke({ by, now, callerToken }) {
    if (callerToken) {
      throw tokenInUse(
        "The token this request is calling with can't be revoked",
      );
    }

    if (!this.isActive(now)) {
      throw notActive("Only an active token can be revoked");
    }

    this.revokedAt = now;
    this.revokedBy = by;
    this.expiresAt = now;
  }

  // Any expiry may be set, and a revoked token set one is revived. The token
  // the request calls with can't be set to stop it.
  changeExpiry({ expiresAt, now, callerToken }) {
    if (!isExpiry(expiresAt)) {
      throw invalidExpiry();
    }

    if (callerToken && !isFuture(expiresAt, now)) {
      throw tokenInUse(
        "The token this request is calling with can't be expired",
      );
    }

    assertExpiry(expiresAt, now);

    const change = {
      previousExpiresAt: this.expiresAt,
      revived: Boolean(this.revokedAt),
    };

    this.expiresAt = expiresAt;
    this.revokedAt = null;
    this.revokedBy = null;

    return change;
  }

  // The successor takes this token's expiry; this one keeps working only for
  // the overlap, and never longer than it already would.
  rotate({ tokenHash, tokenHint, keepOld, by, now, callerToken }) {
    if (!this.isActive(now)) {
      throw notActive("Only an active token can be rotated");
    }

    if (callerToken && KEEP_OLD[keepOld] === 0) {
      throw tokenInUse(
        "The token this request is calling with needs an overlap",
      );
    }

    const successor = AccessToken.issue({
      clientId: this.clientId,
      tokenHash,
      tokenHint,
      expiresAt: this.expiresAt,
      by,
      now,
    });

    this.expiresAt = earlier(this.expiresAt, overlapEnd(keepOld, now));

    return successor;
  }

  // A token that can still call is never deleted, so the one the request
  // calls with never is.
  assertDeletable(now) {
    if (this.isActive(now)) {
      throw refusal(
        Boom.conflict("Revoke the token, or let it expire, before deleting it"),
        "API_TOKEN_ACTIVE",
      );
    }
  }

  toDocument() {
    return {
      id: this.id,
      clientId: this.clientId,
      expiresAt: this.expiresAt,
      createdAt: this.createdAt,
      createdBy: this.createdBy,
      tokenHint: this.tokenHint,
    };
  }

  toView({ inUse }, now = new Date()) {
    return {
      tokenId: this.tokenId,
      clientId: this.clientId,
      status: this.status(now),
      tokenHint: this.tokenHint,
      createdAt: this.createdAt,
      createdBy: this.createdBy,
      expiresAt: this.expiresAt,
      revokedAt: this.revokedAt,
      revokedBy: this.revokedBy,
      inUse,
    };
  }
}
