const DAY_MS = 24 * 60 * 60 * 1000;

export const TOKENS_WITHIN_DAYS = 30;

// An active token is expiring soon with less than TOKENS_WITHIN_DAYS left,
// or with its expiry passed before the owning service marks it expired.
export const isExpiringSoon = ({ status, expiresAt }, now) =>
  status === "ACTIVE" &&
  expiresAt !== null &&
  new Date(expiresAt).getTime() < now.getTime() + TOKENS_WITHIN_DAYS * DAY_MS;
