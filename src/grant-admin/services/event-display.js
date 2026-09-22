const SERVICE_LABELS = {
  gas: "GAS",
  caseworking: "CW-BE",
};

const BOX_LABELS = {
  inbox: "Inbox",
  outbox: "Outbox",
};

const STATUS_BADGES = {
  PUBLISHED: { role: "neutral", retrying: false },
  PROCESSING: { role: "info", retrying: false },
  FAILED: { role: "warning", retrying: true },
  RESUBMITTED: { role: "warning", retrying: true },
  COMPLETED: { role: "success", retrying: false },
  DEAD_LETTER: { role: "error", retrying: false },
  PURGED: { role: "neutral", retrying: false },
};

const UNKNOWN_BADGE = { role: "neutral", retrying: false };

// An unseen status keeps the store's spelling, the string worth grepping for.
const STATUS_LABELS = {
  PUBLISHED: "Queued",
  PROCESSING: "Processing",
  FAILED: "Failed",
  RESUBMITTED: "Resubmitted",
  COMPLETED: "Completed",
  DEAD_LETTER: "Dead letter",
  PURGED: "Purged",
};

const STATUS_EXPLAINERS = {
  PUBLISHED: "Queued, not yet claimed",
  PROCESSING: "Claimed, in flight",
  FAILED: "Awaiting automatic retry",
  RESUBMITTED: "Queued for another retry cycle",
  COMPLETED: "Processed successfully",
  DEAD_LETTER: "Failed all retry attempts; needs a redrive",
  PURGED: "Set aside by an operator; kept until its deletion date",
};

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const DECISECOND = 10;

const serviceName = (service) => SERVICE_LABELS[service] ?? service;

export const hopLabel = ({ service, box }) =>
  `${serviceName(service)} ${BOX_LABELS[box] ?? box}`;

// What an absent operator is called when shown; the row keeps storing null.
export const SYSTEM_ACTOR = "System";

export const actorName = (by) =>
  typeof by === "string" && by.trim() !== "" ? by : SYSTEM_ACTOR;

export const statusDisplay = (status) => {
  const badge = STATUS_BADGES[status] ?? UNKNOWN_BADGE;

  return {
    statusLabel: STATUS_LABELS[status] ?? status,
    statusRole: badge.role,
    statusRetrying: badge.retrying,
  };
};

export const statusVocabulary = () =>
  Object.keys(STATUS_LABELS).map((value) => ({
    value,
    label: STATUS_LABELS[value],
    explainer: STATUS_EXPLAINERS[value],
  }));

export const serviceVocabulary = () =>
  Object.keys(SERVICE_LABELS).map((value) => ({
    value,
    label: SERVICE_LABELS[value],
  }));

export const duration = (ms) => {
  if (ms < MS_PER_SECOND) {
    return `${ms}ms`;
  }

  // Rounded before the unit is chosen, so 59.97s is a minute rather than `60.0s`.
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

export const latency = (from, to) => {
  const started = instant(from);
  const finished = instant(to);

  return started === null || finished === null
    ? null
    : duration(Math.max(0, finished - started));
};

export const latencyTitle = (box) =>
  box === "inbox" ? "Received to completed" : "Queued to delivered to SNS";

export const attemptsLabel = (attempts, maxAttempts) =>
  attempts === null || attempts === undefined
    ? "-"
    : `${attempts}/${maxAttempts ?? "?"}`;
