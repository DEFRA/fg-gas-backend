import { eventStatusValues } from "../../events/event-status-values.js";

const RETRYING = new Set(["FAILED", "RESUBMITTED"]);

const statusValues = new Map(
  eventStatusValues.map((status) => [status.value, status]),
);

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const DECISECOND = 10;

// What an absent operator is called when shown; the row keeps storing null.
export const SYSTEM_ACTOR = "System";

export const actorName = (by) =>
  typeof by === "string" && by.trim() !== "" ? by : SYSTEM_ACTOR;

// An unseen status keeps the store's spelling, the string worth grepping for.
export const statusDisplay = (status) => {
  const { label = status, tone = "neutral" } = statusValues.get(status) ?? {};

  return {
    statusLabel: label,
    statusRole: tone,
    statusRetrying: RETRYING.has(status),
  };
};

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
