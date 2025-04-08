import Wreck from "@hapi/wreck";
import { getTraceId } from "@defra/hapi-tracing";
import { config } from "./config.js";

export const wreck = Wreck.defaults({
  events: true,
  timeout: 3000,
});

wreck.events.on("preRequest", (uri) => {
  const traceId = getTraceId();

  if (traceId) {
    uri.headers[config.tracingHeader] = traceId;
  }
});
