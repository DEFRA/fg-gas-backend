import { createHmac } from "node:crypto";

// Lets someone holding the key confirm what was searched for, without the
// audit ever holding it.
export const valueDigest = (key, text) =>
  createHmac("sha256", key).update(text).digest("hex");
