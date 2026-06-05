import { validateAuditEvent } from "@defra/fcp-audit-publisher";
import { getTraceId } from "@defra/hapi-tracing";
import { randomUUID } from "node:crypto";
import { networkInterfaces } from "node:os";
import { Outbox } from "../grants/models/outbox.js";
import { insertMany } from "../grants/repositories/outbox.repository.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { getRequestContext } from "./request-context.js";

export const SUCCESS = "SUCCESS";
export const FAILURE = "FAILURE";

const getServiceIp = () => {
  for (const iface of Object.values(networkInterfaces())) {
    const addr = iface.find((n) => n.family === "IPv4" && !n.internal);
    if (addr) return addr.address;
  }
  return null;
};

const buildAuditEvent = (entities, details, status, context) => ({
  entities,
  status,
  details: {
    ...(context?.subject && { subject: context.subject }),
    ...details,
  },
});

const buildSecurity = (security) => security && { security };
const getCorrelationId = () => getTraceId() ?? randomUUID();
const getUser = (context) => context?.user ?? undefined;
const getSession = (context) => context?.sessionId ?? undefined;
const getIP = (context) => context?.ip ?? getServiceIp();

const buildPayload = (context, { entities, details, status, security }) => ({
  datetime: new Date().toISOString(),
  version: config.serviceVersion,
  application: config.serviceName,
  component: config.serviceName,
  environment: config.cdpEnvironment,
  correlationid: getCorrelationId(),
  user: getUser(context),
  sessionid: getSession(context),
  ip: getIP(context),
  audit: buildAuditEvent(entities, details, status, context),
  security: buildSecurity(security),
});

export const createAuditCallback =
  ({ entities, details, messageGroupId, security }) =>
  (session) =>
    writeAuditEvent(
      {
        entities,
        details: typeof details === "function" ? details() : details,
        messageGroupId,
        status: session ? SUCCESS : FAILURE,
        security,
      },
      session,
    );

export const writeAuditEvent = async (
  { entities, details, messageGroupId, status, security },
  session,
) => {
  logger.info("Begin write audit event.");
  const context = getRequestContext();
  const payload = buildPayload(context, {
    entities,
    details,
    status,
    security,
  });

  logger.debug(context, "audit context");
  logger.debug(payload, "audit payload");
  const { valid, errors } = validateAuditEvent(payload);
  if (!valid) {
    logger.warn({ errors }, "Audit event failed validation - not writing");
    return;
  }

  const msgGroupId = messageGroupId ?? randomUUID();
  const outboxEntry = new Outbox({
    event: { ...payload, messageGroupId: msgGroupId },
    target: config.sns.auditTopicArn,
    segregationRef: msgGroupId,
  });

  await insertMany([outboxEntry], session);
  logger.info({ outboxEntry }, "Written audit event to outbox.");
};
