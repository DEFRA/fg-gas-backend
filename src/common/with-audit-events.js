import { publishAuditEvent, validateAuditEvent } from "@defra/fcp-audit-publisher";
import { getTraceId } from "@defra/hapi-tracing";
import { randomUUID } from "node:crypto";
import { networkInterfaces } from "node:os";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { getRequestContext } from "./request-context.js";
import { snsClient } from "./sns-client.js";

const SUCCESS = "SUCCESS";
const FAILURE = "FAILURE";

const auditConfig = () => ({
  snsClient,
  sns: { topicArn: config.sns.auditTopicArn },
  application: config.serviceName,
  component: config.serviceName,
  environment: config.cdpEnvironment,
  version: config.serviceVersion,
});

const getServiceIp = () => {
  for (const iface of Object.values(networkInterfaces())) {
    const addr = iface.find((n) => n.family === "IPv4" && !n.internal);
    if (addr) return addr.address;
  }
  return null;
};

const buildAudit = (audit, context, status) => {
  return audit && {
    ...audit,
    status,
    details: {
      ...(context?.subject && { subject: context.subject }),
      ...audit.details,
    },
  };
};

const buildSecurity = (security) => {
  return security && {
    ...security,
  };
};

const getUserId = (context) => {
  return context?.user ?? undefined;
};

const getSessionId = (context) => {
  return context?.sessionId ?? undefined;
};

const getCorrelationId = () => getTraceId() ?? randomUUID();

const getIp = (context) => {
  return context?.ip ?? getServiceIp();
};

const buildPayload = (context, status, { audit, security }, auditConfig) => ({
  datetime: new Date().toISOString(),
  version: auditConfig.version,
  application: auditConfig.application,
  component: auditConfig.component,
  environment: auditConfig.environment,
  correlationid: getCorrelationId(),
  user: getUserId(context),
  sessionid: getSessionId(context),
  ip: getIp(context),
  audit: buildAudit(audit, context, status),
  security: buildSecurity(security),
});

const fireAuditEvent = (payload) => {
  const cfg = auditConfig();
  console.log("cfg", cfg);
  if (!cfg.sns.topicArn) {
    logger.debug("Audit topic not configured - skipping publish");
    return;
  }
  const { valid, errors } = validateAuditEvent(payload);
  if (!valid) {
    logger.warn({ errors }, "Audit event failed validation - not publishing");
    return;
  }
  publishAuditEvent(payload, cfg).catch((err) =>
    logger.error({ err }, "Failed to publish audit event"),
  );
};

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
        auditConfig(),
      );
      console.log("payload", payload);
      fireAuditEvent(payload);
    }
  };
