import { pino } from "pino";
import { ecsFormat } from "@elastic/ecs-pino-format";
import { getTraceId } from "@defra/hapi-tracing";
import { config } from "./config.js";

const log = config.get("log");

const format = {
  ecs: {
    ...ecsFormat({
      serviceVersion: config.get("serviceVersion"),
      serviceName: config.get("serviceName"),
    }),
  },
  "pino-pretty": {
    transport: {
      target: "pino-pretty",
    },
  },
}[log.format];

export const logger = pino({
  enabled: log.enabled,
  ignorePaths: ["/health"],
  redact: {
    paths: log.redact,
    remove: true,
  },
  level: log.level,
  ...format,
  nesting: true,
  mixin() {
    const mixinValues = {};
    const traceId = getTraceId();
    if (traceId) {
      mixinValues.trace = {
        id: traceId,
      };
    }
    return mixinValues;
  },
});
