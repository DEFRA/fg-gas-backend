import { getTraceId } from "@defra/hapi-tracing";
import Wreck from "@hapi/wreck";
import { config } from "./config.js";

export const wreck = Wreck.defaults({
  events: true,
  timeout: config.httpClient.timeoutMs,
});

wreck.events.on("preRequest", (uri) => {
  const traceId = getTraceId();

  if (traceId) {
    uri.headers[config.tracingHeader] = traceId;
  }
});
