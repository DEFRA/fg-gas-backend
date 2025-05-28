import { pino } from "pino";
import { ecsFormat } from "@elastic/ecs-pino-format";
import { config } from "./config.js";
import { getTraceParent } from "./eventTraceParent.js";

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
      config.NODE_ENV === "production"
        ? ["req.headers.authorization", "req.headers.cookie", "res.headers"]
        : ["req", "res", "responseTime"],
    remove: true,
  },
  level: config.logLevel,
  ...format,
  nesting: true,
  mixin() {
    const mixinValues = {};
    const traceId = getTraceParent();
    if (traceId) {
      mixinValues.trace = {
        id: traceId,
      };
    }
    return mixinValues;
  },
});
