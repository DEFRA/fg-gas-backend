import Boom from "@hapi/boom";
import crypto from "node:crypto";
import { db } from "../common/mongo-client.js";

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

export const auth = {
  plugin: {
    name: "auth",
    register: async (server) => {
      await registerServiceAuth(server);
    },
  },
};
