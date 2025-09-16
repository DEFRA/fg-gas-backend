import Wreck from "@hapi/wreck";
import { randomUUID } from "node:crypto";
import { env } from "node:process";

export const wreck = Wreck.defaults({
  events: true,
  timeout: 3000,
  baseUrl: env.API_URL,
  json: true,
});

wreck.events.on("preRequest", (uri) => {
  uri.headers["x-cdp-request-id"] ??= randomUUID().replaceAll("-", "");
});
