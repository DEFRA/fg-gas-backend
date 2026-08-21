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

// FGP-1307: x-encrypted-auth carries the signed caller JWT and must never be
// serialized to logs. It is redacted alongside the existing sensitive headers.
export const productionRedactPaths = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["x-encrypted-auth"]',
  'req.headers["x-agreement-client-ref"]',
  'req.headers["x-agreement-sbi"]',
  "res.headers",
];

export const logger = pino({
  enabled: config.logEnabled,
  ignorePaths: ["/health"],
  redact: {
    paths:
      config.env === "production"
        ? productionRedactPaths
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
      mixinValues["trace.id"] = id;
    }

    return mixinValues;
  },
});
