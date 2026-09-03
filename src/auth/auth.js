import Boom from "@hapi/boom";
import crypto from "node:crypto";
import { config } from "../common/config.js";
import { logger } from "../common/logger.js";
import { db } from "../common/mongo-client.js";
import { verifyCallerToken } from "./caller-token.js";

const CALLER_TOKEN_HEADER = "x-encrypted-auth";

// FGP-1307: reason recorded/logged when no caller token is present on an
// agreement route (used in both warn-only and enforcement paths).
const MISSING_TOKEN_REASON = "missing-token";

const hashToken = (raw) => {
  return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
};

// Extract and validate a bearer token from the Authorization header
const getBearerToken = (header) => {
  if (typeof header !== "string" || !header.startsWith("Bearer ")) {
    throw Boom.unauthorized("Missing bearer token");
  }
  return header.slice("Bearer ".length).trim();
};

// Predicate to determine whether an access token record has expired
const isExpired = (record, now = new Date()) =>
  Boolean(record?.expiresAt && now > record.expiresAt);

const setupAccessTokens = () => {
  const col = db.collection("access_tokens");
  return {
    findById: async (id) => col.findOne({ id }),
  };
};

const registerServiceAuth = async (server) => {
  const tokens = setupAccessTokens();

  server.auth.scheme("service-bearer", () => ({
    authenticate: async (request, h) => {
      const tokenHash = hashToken(
        getBearerToken(request.headers.authorization),
      );
      const record = await tokens.findById(tokenHash);

      if (!record || isExpired(record)) {
        throw Boom.unauthorized("Invalid token");
      }

      return h.authenticated({
        credentials: { service: record.clientId, tokenId: record.id },
      });
    },
  }));

  server.auth.strategy("service", "service-bearer");
  server.auth.default("service"); // Apply this strategy by default - `/health` and `/documentation` are opted out
};

// FGP-1307: GAS verifies the caller token forwarded by Agreements UI itself,
// rather than trusting the unsigned x-agreement-* identity headers.
//
// Rollout is feature-flag driven (config.callerToken.enforce). When enforcement
// is OFF the checks run in warn-only mode (logged but not enforced, x-agreement-*
// headers still honoured for identity). When enforcement is ON a missing/invalid
// caller token or a claim mismatch rejects the request, and caller identity is
// derived from the verified token claims instead of the x-agreement-* headers.
//
// Verification is scoped to the agreement routes that consume caller identity,
// so unrelated GAS endpoints (e.g. /grants/*) are unaffected now and won't be
// dragged into caller-token enforcement later.
const CALLER_TOKEN_ROUTES = new Set([
  "/agreements/current",
  "/agreements/{agreementNumber}/document",
  "/agreements/{agreementNumber}/actions/{actionName}",
]);

const isCallerTokenRoute = (request) =>
  CALLER_TOKEN_ROUTES.has(request.route?.path);

const verifyRequestCallerToken = (token) =>
  verifyCallerToken(token, config.callerToken.secret, {
    audience: config.callerToken.audience,
    allowedIssuers: config.callerToken.allowedIssuers,
    defaultKid: config.callerToken.defaultKid,
    keyring: config.callerToken.keyring,
  });

const logCallerTokenResult = (request, result) => {
  if (!result.verified) {
    logger.warn(
      { reason: result.reason, path: request.path },
      "Caller token failed verification (FGP-1307); accepted for now",
    );
  } else if (result.warnings.length > 0) {
    logger.warn(
      { warnings: result.warnings, path: request.path },
      "Caller token verified with claim warnings (FGP-1307)",
    );
  } else {
    logger.info(
      { iss: result.payload.iss },
      "Caller token verified (FGP-1307)",
    );
  }
};

// FGP-1307: warn-only mode. Record the verification outcome but never reject.
const handleWarnOnlyCallerToken = (request, token) => {
  if (!token) {
    request.app.callerToken = {
      verified: false,
      reason: MISSING_TOKEN_REASON,
    };
    logger.warn(
      { reason: MISSING_TOKEN_REASON, path: request.path },
      "Caller token missing on agreement route (FGP-1307); accepted for now",
    );
    return;
  }

  const result = verifyRequestCallerToken(token);
  request.app.callerToken = result;
  logCallerTokenResult(request, result);
};

// FGP-1307: enforcement mode. Reject the request unless a caller token is present,
// verifies, and carries no claim mismatches.
const handleEnforcedCallerToken = (request, token) => {
  if (!token) {
    logger.warn(
      { reason: MISSING_TOKEN_REASON, path: request.path },
      "Caller token missing on agreement route (FGP-1307); rejected",
    );
    throw Boom.unauthorized("Caller token required");
  }

  const result = verifyRequestCallerToken(token);

  if (!result.verified) {
    logger.warn(
      { reason: result.reason, path: request.path },
      "Caller token failed verification (FGP-1307); rejected",
    );
    throw Boom.unauthorized("Invalid caller token");
  }

  if (result.warnings.length > 0) {
    logger.warn(
      { warnings: result.warnings, path: request.path },
      "Caller token has claim mismatches (FGP-1307); rejected",
    );
    throw Boom.unauthorized("Invalid caller token");
  }

  request.app.callerToken = result;
  logger.info(
    { iss: result.payload.iss },
    "Caller token verified (FGP-1307)",
  );
};

const registerCallerTokenVerification = (server) => {
  server.ext("onPostAuth", (request, h) => {
    if (!isCallerTokenRoute(request)) {
      return h.continue;
    }

    const token = request.headers[CALLER_TOKEN_HEADER];

    if (config.callerToken.enforce) {
      handleEnforcedCallerToken(request, token);
    } else {
      handleWarnOnlyCallerToken(request, token);
    }

    return h.continue;
  });
};

export const auth = {
  plugin: {
    name: "auth",
    register: async (server) => {
      await registerServiceAuth(server);
      registerCallerTokenVerification(server);
    },
  },
};
