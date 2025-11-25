import { tracing } from "@defra/hapi-tracing";
import hapi from "@hapi/hapi";
import Inert from "@hapi/inert";
import Vision from "@hapi/vision";
import hapiPino from "hapi-pino";
import hapiPulse from "hapi-pulse";
import HapiSwagger from "hapi-swagger";
import { auth } from "./auth/auth.js";
import { config } from "./common/config.js";
import { logger } from "./common/logger.js";
import { mongoClient } from "./common/mongo-client.js";

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
        auth: false,
      },
    },
    auth,
  ]);

  // SonarCloud magic numbers
  const statusCodes = {
    badRequest: 400,
    internalServerError: 500,
  };

  server.ext("onPreResponse", (request, h) => {
    const response = request.response;

    if (
      response.isBoom &&
      response.output.statusCode >= statusCodes.badRequest &&
      response.output.statusCode < statusCodes.internalServerError
    ) {
      const error = new Error(response.message);

      // CDP doesn't support error.stack
      delete error.stack;
      error.stack_trace = response.stack;

      logger.error(error);
    }

    return h.continue;
  });

  return server;
};
