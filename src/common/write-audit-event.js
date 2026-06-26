import { validateAuditEvent } from "@defra/fcp-audit-publisher";
import { getTraceId } from "@defra/hapi-tracing";
import { randomUUID } from "node:crypto";
import { networkInterfaces } from "node:os";
import { Outbox } from "../grants/models/outbox.js";
import { insertMany } from "../grants/repositories/outbox.repository.js";
import { config } from "./config.js";
import { getRequestContext } from "./get-request-context.js";
import { logger } from "./logger.js";

// helpers to stop lint complaining about complexity.
const buildSecurity = (security) => security && { security };
const getCorrelationId = () => getTraceId() ?? randomUUID();
const getUser = (context) => context?.user ?? undefined;
const getSession = (context) => context?.sessionId ?? undefined;
const getIP = (context) => context?.ip ?? getServiceIp();
const getServiceIp = () => {
  for (const iface of Object.values(networkInterfaces())) {
    const addr = iface.find((n) => n.family === "IPv4" && !n.internal);
    if (addr) return addr.address;
  }
  return null;
};
export const createAuditPayload = (accounts, entities, details, status) => ({
  entities,
  status,
  accounts,
  details,
});

export const buildPayload = (
  context,
  { entities, accounts, details, status, security },
) => ({
  datetime: new Date().toISOString(),
  version: config.serviceVersion,
  application: "Grants Platform",
  component: config.serviceName,
  environment: config.cdpEnvironment,
  correlationid: getCorrelationId(),
  user: getUser(context),
  sessionid: getSession(context),
  ip: getIP(context),
  audit: createAuditPayload(accounts, entities, details, status),
  security: buildSecurity(security),
});

export const writeAuditEvent = async (
  { entities, accounts, details, messageGroupId, status, security },
  session,
) => {
  logger.info("Begin write audit event.");

  const context = getRequestContext();
  const payload = buildPayload(context, {
    entities,
    accounts,
    details,
    security,
    status,
  });
  logger.debug(payload, "audit event payload");
  const { valid, errors } = validateAuditEvent(payload);
  if (!valid) {
    logger.warn(errors, "Audit event failed validation - skipping write.");
  } else {
    const msgGroupId = messageGroupId ?? randomUUID();

    const outboxEntry = new Outbox({
      event: { ...payload, messageGroupId: msgGroupId },
      target: config.sns.auditTopicArn,
      segregationRef: msgGroupId,
    });

    await insertMany([outboxEntry], session);
  }
  logger.info("End write audit event.");
};
