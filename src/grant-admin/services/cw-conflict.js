import { statusDisplay } from "./event-display.js";

// A Caseworking 409 gains the status label a GAS conflict carries, so the
// admin reads one shape whichever service refused.
const conflictPayload = (error) => error.output?.payload;

export const withStatusLabel = (error) => {
  const payload = conflictPayload(error) ?? {};

  if (payload.status) {
    payload.statusLabel = statusDisplay(payload.status).statusLabel;
  }

  throw error;
};
