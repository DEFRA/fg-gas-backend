// Every display string a row wears is decided here, not in the frontend: a
// label derived in two places eventually reads two ways, and three surfaces
// (list, detail, journey) must agree about one row. Deliberately left to the
// frontend: anything needing the render-time clock (`4m ago` goes stale in an
// open tab), hrefs, and truncation.

const SERVICE_LABELS = {
  gas: "GAS",
  caseworking: "CW",
};

const BOX_LABELS = {
  inbox: "Inbox",
  outbox: "Outbox",
};

// `?` is the placeholder for a producer a row does not name.
const FULL_NAMES = {
  GAS: "GAS",
  CW: "Caseworking",
  AS: "Agreements",
  PAY: "Payments",
  AUDIT: "Audit",
  "?": "unknown",
};

const UNKNOWN_PRODUCER = "?";
const INTERNAL_BUS_NAME = "internal";

// Amber is reserved for the two states actually retrying - what an operator
// scans for. An unseen status falls to `neutral` rather than a blank cell.
const STATUS_BADGES = {
  PUBLISHED: { role: "neutral", retrying: false },
  PROCESSING: { role: "info", retrying: false },
  FAILED: { role: "warning", retrying: true },
  RESUBMITTED: { role: "warning", retrying: true },
  COMPLETED: { role: "success", retrying: false },
  DEAD_LETTER: { role: "error", retrying: false },
};

const UNKNOWN_BADGE = { role: "neutral", retrying: false };

// A status we have never seen keeps the store's own spelling: an invented
// sentence case would only hide the string worth grepping for.
const STATUS_LABELS = {
  PUBLISHED: "Published",
  PROCESSING: "Processing",
  FAILED: "Failed",
  RESUBMITTED: "Resubmitted",
  COMPLETED: "Completed",
  DEAD_LETTER: "Dead letter",
};

// Chip-title explainers. Each line answers the operator's first question:
// is the poller still trying?
const STATUS_EXPLAINERS = {
  PUBLISHED: "Queued, not yet claimed",
  PROCESSING: "Claimed, in flight",
  FAILED: "Awaiting automatic retry",
  RESUBMITTED: "Queued for another retry cycle",
  COMPLETED: "Processed successfully",
  DEAD_LETTER: "Failed all retry attempts; needs a redrive",
};

// Where a topic's messages land, read off the platform's subscriptions
// (floci 10-core-resources.sh:165-189, cross-checked against each consumer's
// config.js) - NOT off the topic's prefix: the platform names topics for their
// PUBLISHER, so a prefix rule renders every real hop as a self-route. Keyed by
// the normalised name, so every spelling of a topic finds one entry.
const TOPIC_CONSUMERS = {
  create_new_case: "CW",
  update_case_status: "CW",
  case_status_updated: "GAS",
  update_agreement_status: "AS",
  agreement_status_updated: "GAS",
  create_agreement: "AS",
  create_payment: "PAY",
  // Every service publishes its own audit topic; they feed the audit stream,
  // not a service.
  audit: "AUDIT",
  audit_topic_arn: "AUDIT",
};

// Publisher-and-transport prefix (`cw__sns__`, `gas__sqs__`) - the hop label
// has already named both.
const TOPIC_PREFIX = /^[^\s]*?__(?:sns|sqs)__/;

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
// A tenth of a second, the resolution the `1.2s` spelling reports in.
const DECISECOND = 10;

const bareTopic = (topic) => topic.replace(TOPIC_PREFIX, "");

// The same destination is spelled three ways across the estate:
// `gas__sns__create_new_case_fifo.fifo`, `create_payment.fifo`,
// `cw__sns__audit_fifo`. Stripping prefix and both fifo suffixes leaves the
// part the consumer map is keyed on.
const normalisedTopic = (topic) =>
  bareTopic(topic)
    .replace(/\.fifo$/, "")
    .replace(/_fifo$/, "");

const fullName = (label) => FULL_NAMES[label] ?? label;

const serviceName = (service) => SERVICE_LABELS[service] ?? service;

/** `GAS Inbox` - which hop of the journey a row is. */
export const hopLabel = ({ service, box }) =>
  `${serviceName(service)} ${BOX_LABELS[box] ?? box}`;

/**
 * A redrive nobody is named for was not made by an anonymous operator: it was
 * made by the platform itself, on a schedule or a sweep. The row stores `null`
 * and keeps storing it - the ABSENCE of an operator is the fact, and writing a
 * name into the document would make the platform indistinguishable from a
 * person called System. This is only what that absence is called when it is
 * shown, and Caseworking already calls the same actor `System` on a case
 * timeline.
 *
 * Blank counts as absent: `x-actor` is trimmed and `.empty("")` at the route,
 * so only a row written before that could hold one, and a redrive attributed
 * to "   " is not attributed.
 */
export const SYSTEM_ACTOR = "System";

export const actorName = (by) =>
  typeof by === "string" && by.trim() !== "" ? by : SYSTEM_ACTOR;

/** The words a status is spelled in, the colour it wears, and whether it retries. */
export const statusDisplay = (status) => {
  const badge = STATUS_BADGES[status] ?? UNKNOWN_BADGE;

  return {
    statusLabel: STATUS_LABELS[status] ?? status,
    statusRole: badge.role,
    statusRetrying: badge.retrying,
  };
};

// Chip order is the order a message travels, not alphabetical: the strip
// reads left to right as a lifecycle.
export const statusVocabulary = () =>
  Object.keys(STATUS_LABELS).map((value) => ({
    value,
    label: STATUS_LABELS[value],
    explainer: STATUS_EXPLAINERS[value],
  }));

export const serviceVocabulary = () =>
  Object.keys(SERVICE_LABELS).map((value) => ({
    value,
    label: fullName(SERVICE_LABELS[value]),
  }));

// A topic no subscription names falls back to the normalised topic itself,
// not the raw `gas__sns__…_fifo.fifo` token that only repeats the hop above.
const outboxDestination = (target, own) => {
  if (target === INTERNAL_BUS_NAME) {
    return fullName(own);
  }

  const consumer = TOPIC_CONSUMERS[normalisedTopic(target)];

  return consumer ? fullName(consumer) : normalisedTopic(target);
};

/**
 * `to Caseworking` on an outbox row, `from Agreements` on an inbox one.
 * `queueValue` is the topic exactly as the row carries it - the shown line is
 * prefix-stripped, but the whole name is what gets pasted into a console or
 * log query.
 */
export const queueLine = ({ service, box, source, target }) => {
  if (box !== "outbox") {
    return {
      queue: `from ${fullName(source ?? UNKNOWN_PRODUCER)}`,
      queueValue: null,
    };
  }

  return target === null
    ? { queue: null, queueValue: null }
    : {
        queue: `to ${outboxDestination(target, serviceName(service))}`,
        queueValue: target,
      };
};

// Past an hour it reads `5h 34m` rather than `334m 0s`: a backoff gap should
// be recognisable at a glance, not a number to be divided.
export const duration = (ms) => {
  if (ms < MS_PER_SECOND) {
    return `${ms}ms`;
  }

  // Rounded to tenths BEFORE the unit is chosen, so 59.97 seconds is a minute
  // rather than the `60.0s` a later rounding would have printed.
  const tenths = Math.round((ms * DECISECOND) / MS_PER_SECOND);

  if (tenths < SECONDS_PER_MINUTE * DECISECOND) {
    return `${(tenths / DECISECOND).toFixed(1)}s`;
  }

  const whole = Math.round(ms / MS_PER_SECOND);
  const minutes = Math.floor(whole / SECONDS_PER_MINUTE);

  return minutes < MINUTES_PER_HOUR
    ? `${minutes}m ${whole % SECONDS_PER_MINUTE}s`
    : `${Math.floor(minutes / MINUTES_PER_HOUR)}h ${minutes % MINUTES_PER_HOUR}m`;
};

const instant = (value) => {
  const parsed = value ? Date.parse(value) : Number.NaN;

  return Number.isNaN(parsed) ? null : parsed;
};

// Null unless both instants exist: a completion nothing recorded is not a
// latency of zero.
export const latency = (from, to) => {
  const started = instant(from);
  const finished = instant(to);

  return started === null || finished === null
    ? null
    : duration(Math.max(0, finished - started));
};

/** What the two ends of a row's own duration are, in words. */
export const latencyTitle = (box) =>
  box === "inbox" ? "Received to completed" : "Queued to delivered to SNS";

/** `3/5`, or a dash where no count was recorded. */
export const attemptsLabel = (attempts, maxAttempts) =>
  attempts === null || attempts === undefined
    ? "-"
    : `${attempts}/${maxAttempts ?? "?"}`;

// A count is only news when the row failed or took more than one go: `1/5`
// on a completed-first-try row is the figure every healthy event carries.
export const showsAttempts = (attempts, failed) =>
  failed || (attempts !== null && attempts !== undefined && attempts > 1);

// When a hop began, by its own box's clock. An inbox row's `createdAt` is the
// CloudEvent's producer-stamped `time`, so timing a hop from it would book
// the transit leg to the consumer; a CW row carries no receipt instant and
// falls back to `createdAt`.
export const startedAt = ({ box, createdAt, publicationDate }) =>
  box === "inbox" ? (publicationDate ?? createdAt) : createdAt;
