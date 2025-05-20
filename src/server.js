import hapi from "@hapi/hapi";
import hapiPino from "hapi-pino";
import hapiPulse from "hapi-pulse";
import { tracing } from "@defra/hapi-tracing";
import { logger } from "./common/logger.js";
import { mongoClient } from "./common/db.js";
import { config } from "./common/config.js";
import { healthPlugin } from "./health/index.js";
import { grantsPlugin } from "./grants/index.js";
import HapiSwagger from "hapi-swagger";
import Inert from "@hapi/inert";
import Vision from "@hapi/vision";

export const createServer = async () => {
  const server = hapi.server({
    port: config.port,
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
        tracingHeader: config.tracingHeader,
      },
    },
    {
      plugin: hapiPulse,
      options: {
        logger,
        timeout: 10_000,
      },
    },
    Inert,
    Vision,
    {
      plugin: HapiSwagger,
      options: {
        info: {
          title: "Grant Application Service",
          version: config.serviceVersion,
        },
      },
    },
  ]);

  await server.register([healthPlugin, grantsPlugin]);

  return server;
};
