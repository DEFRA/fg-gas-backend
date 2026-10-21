export const eventStatusValues = Object.freeze([
  { value: "PUBLISHED", label: "Queued", tone: "neutral" },
  { value: "PROCESSING", label: "Processing", tone: "info" },
  { value: "FAILED", label: "Failed", tone: "warning" },
  { value: "RESUBMITTED", label: "Resubmitted", tone: "warning" },
  { value: "COMPLETED", label: "Completed", tone: "success" },
  { value: "DEAD_LETTER", label: "Dead letter", tone: "error" },
  { value: "PURGED", label: "Purged", tone: "neutral" },
]);
