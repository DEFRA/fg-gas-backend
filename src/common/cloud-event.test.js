import { describe, expect, it } from "vitest";
import { CloudEvent } from "./cloud-event.js";
import { config } from "./config.js";
import { withTraceParent } from "./trace-parent.js";

describe("CloudEvent", () => {
  it("creates a CloudEvent with base properties", async () => {
    const event = await withTraceParent(
      "1234-0987",
      async () =>
        new CloudEvent("test.type", {
          key: "value",
        }),
    );

    expect(event).toEqual({
      id: expect.any(String),
      time: expect.any(String),
      source: config.serviceName,
      specversion: "1.0",
      datacontenttype: "application/json",
      type: `cloud.defra.${config.cdpEnvironment}.${config.serviceName}.test.type`,
      traceparent: "1234-0987",
      data: {
        key: "value",
      },
    });
  });
});
