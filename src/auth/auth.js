import Boom from "@hapi/boom";
import crypto from "node:crypto";
import { config } from "../common/config.js";
import { logger } from "../common/logger.js";
import { db } from "../common/mongo-client.js";
import { verifyCallerToken } from "./caller-token.js";

const CALLER_TOKEN_HEADER = "x-encrypted-auth";

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
// rather than trusting the unsigned x-agreement-* identity headers. This runs
// in a backwards-compatible ("warn-only") mode: results are logged but not
// enforced, and the x-agreement-* headers are still honoured for now.
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

const registerCallerTokenVerification = (server) => {
  server.ext("onPostAuth", (request, h) => {
    if (!isCallerTokenRoute(request)) {
      return h.continue;
    }

    const token = request.headers[CALLER_TOKEN_HEADER];

    // TODO (FGP-1307): once every caller forwards the caller token, require it
    // here and stop trusting the unsigned x-agreement-* headers for identity.
    if (!token) {
      // Record the absence so we can measure whether every Agreements UI
      // request carries a caller token before enforcement is switched on.
      request.app.callerToken = { verified: false, reason: "missing-token" };
      logger.warn(
        { reason: "missing-token", path: request.path },
        "Caller token missing on agreement route (FGP-1307); accepted for now",
      );
      return h.continue;
    }

    const result = verifyCallerToken(token, config.callerToken.secret, {
      audience: config.callerToken.audience,
      allowedIssuers: config.callerToken.allowedIssuers,
    });

    request.app.callerToken = result;
    logCallerTokenResult(request, result);

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
