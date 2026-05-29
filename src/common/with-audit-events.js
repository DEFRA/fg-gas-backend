import { getTraceId } from "@defra/hapi-tracing";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { getRequestContext } from "./request-context.js";
import { publish } from "./sns-client.js";

const SUCCESS = "SUCCESS";
const FAILURE = "FAILURE";
const EVENT_VERSION = "1.1";

const processSecurity = (data) => {
  return data && { security: data };
};

const processAudit = (data, status, context) => {
  return (
    data && {
      audit: {
        ...data,
        status,
        details: {
          ...(context?.subject && { subject: context.subject }),
          ...data.details,
        },
      },
    }
  );
};

// eslint-disable-next-line complexity
const buildPayload = (context, status, { audit, security }) => ({
  user: context?.user ?? null,
  ip: context?.ip ?? null,
  sessionid: context?.sessionId ?? null,
  correlationId: getTraceId() ?? null,
  datetime: new Date().toISOString(),
  environment: config.cdpEnvironment,
  version: EVENT_VERSION,
  application: config.serviceName,
  ...processSecurity(security),
  ...processAudit(audit, status, context),
});

export const withAuditEvents =
  (useCase, buildAuditEvent) =>
  async (...args) => {
    let status = SUCCESS;
    let result;
    try {
      result = await useCase(...args);
      return result;
    } catch (e) {
      status = FAILURE;
      throw e;
    } finally {
      const context = getRequestContext();
      const payload = buildPayload(
        context,
        status,
        buildAuditEvent({ args, result, status, context }),
      );
      publish(config.sns.auditTopicArn, payload).catch((err) =>
        logger.error({ err }, "Failed to publish audit event"),
      );
    }
  };
