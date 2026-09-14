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
    if (addr) {
      return addr.address;
    }
  }
  return null;
};
const getAccounts = (values) => {
  let accounts;
  const { sbi, crn, frn } = values;
  if (sbi || crn || frn) {
    accounts = { sbi, crn, frn };
  }
  return accounts;
};
const isPlainObject = (value) => value?.constructor === Object;

export const stripNulls = (obj) => {
  const result = {};

  for (const [key, value] of Object.entries(obj)) {
    if (value == null) {
      continue;
    }

    result[key] = isPlainObject(value) ? stripNulls(value) : value;
  }

  return result;
};

export const createAuditPayload = ({
  accountDetails = {},
  entities,
  status,
  details,
}) => {
  return {
    entities,
    status,
    accounts: getAccounts(accountDetails),
    details,
  };
};

export const buildPayload = (
  context,
  { entities, accounts, status, security, details },
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
  audit: createAuditPayload({
    accountDetails: accounts,
    entities,
    status,
    details,
  }),
  ...buildSecurity(security),
});

export const writeAuditEvent = async (
  { entities, accounts, details, status, security, segregationRef },
  session,
) => {
  logger.info("Begin write audit event.");

  const context = getRequestContext();

  const payload = stripNulls(
    buildPayload(context, { entities, accounts, security, status, details }),
  );

  const { valid, errors } = validateAuditEvent(payload);

  if (valid === false) {
    logger.warn(errors, "Audit event failed validation - skipping write.");

    // The same hole a failed insert was, one layer up: inside a caller's
    // transaction, skipping the write would let the action commit with no
    // audit event. An invalid payload is a FAILURE to produce the audit the
    // caller asked for - unlike a `dataBuilder` answering null, which is a
    // deliberate "nothing to audit here". So it aborts the transaction.
    //
    // The reason is already in the warning above; it is deliberately not in
    // the error, which travels back to the caller - a validation message can
    // quote the payload it rejected.
    if (session) {
      throw new Error("Audit event failed validation");
    }
  } else {
    // The audit topic is not FIFO, so segregationRef carries no ordering
    // meaning here - it only partitions outbox work. Callers group related
    // events under a shared ref so they claim in batches and the fifo_locks
    // collection stays bounded; the uuid is a last resort for ungrouped ones.
    const outboxEntry = new Outbox({
      event: payload,
      target: config.sns.auditTopicArn,
      segregationRef: segregationRef ?? randomUUID(),
    });

    await insertMany([outboxEntry], session);
  }

  logger.info("End write audit event.");
};
