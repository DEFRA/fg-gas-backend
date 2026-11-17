import { config } from "./config.js";

// The longest a bucket or Explore read runs on the server.
export const readTimeoutMs = () => config.adminReadTimeoutMs;
