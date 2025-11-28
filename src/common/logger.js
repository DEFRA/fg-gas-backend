import { getTraceId } from "@defra/hapi-tracing";
import { ecsFormat } from "@elastic/ecs-pino-format";
import { pino } from "pino";
import { config } from "./config.js";
import { getTraceParent } from "./trace-parent.js";

const format = {
  ecs: {
    ...ecsFormat({
      serviceVersion: config.serviceVersion,
      serviceName: config.serviceName,
    }),
  },
  "pino-pretty": {
    transport: {
      target: "pino-pretty",
    },
  },
}[config.logFormat];

export const logger = pino({
  enabled: config.logEnabled,
  ignorePaths: ["/health"],
  redact: {
    paths:
      config.env === "production"
        ? ["req.headers.authorization", "req.headers.cookie", "res.headers"]
        : ["req", "res", "responseTime"],
    remove: true,
  },
  level: config.logLevel,
  ...format,
  nesting: true,
  errorKey: "error",
  mixin() {
    const mixinValues = {};

    const id = getTraceId() ?? getTraceParent();

    if (id) {
      mixinValues.trace = {
        id,
      };
    }

    return mixinValues;
  },
});
