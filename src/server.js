import hapi from "@hapi/hapi";
import hapiPino from "hapi-pino";
import hapiPulse from "hapi-pulse";
import { tracing } from "@defra/hapi-tracing";
import { logger } from "./common/logger.js";
import { mongoClient } from "./common/db.js";
import { config } from "./common/config.js";
import { healthPlugin } from "./health/index.js";
import { grantsPlugin } from "./grants/index.js";
import crypto from "crypto";

export const createServer = async () => {
  const server = hapi.server({
    port: config.get("port"),
    routes: {
      validate: {
        options: {
          abortEarly: false,
        },
        failAction: async (_request, _h, error) => {
          logger.warn(error, error?.message);
          throw error;
        },
      },
      security: {
        hsts: {
          maxAge: 31536000,
          includeSubDomains: true,
          preload: false,
        },
        xss: "enabled",
        noSniff: true,
        xframe: true,
      },
    },
    router: {
      stripTrailingSlash: true,
    },
  });

  server.events.on("start", async () => {
    await mongoClient.connect();
  });

  server.events.on("stop", async () => {
    await mongoClient.close(true);
  });

  server.ext("onPreResponse", (request, h) => {
    if (!request.response.header) {
      return h.continue;
    }

    const traceId =
      request.headers["x-cdp-request-id"] ||
      crypto.randomUUID().replaceAll("-", "");

    request.response.header("x-cdp-request-id", traceId);

    return h.continue;
  });

  await server.register([
    {
      plugin: hapiPino,
      options: {
        ignorePaths: ["/health"],
        instance: logger,
      },
    },
    {
      plugin: tracing.plugin,
      options: {
        tracingHeader: config.get("tracing.header"),
      },
    },
    {
      plugin: hapiPulse,
      options: {
        logger,
        timeout: 10_000,
      },
    },
  ]);

  await server.register([healthPlugin, grantsPlugin]);

  return server;
};
