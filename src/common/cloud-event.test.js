import { describe, expect, it } from "vitest";
import { CloudEvent } from "./cloud-event.js";
import { config } from "./config.js";

describe("CloudEvent", () => {
  it("creates a CloudEvent with base properties", () => {
    const event = new CloudEvent("test.type", {
      key: "value",
    });

    expect(event).toEqual({
      id: expect.any(String),
      time: expect.any(String),
      source: config.serviceName,
      specversion: "1.0",
      datacontenttype: "application/json",
      type: `cloud.defra.${config.env}.${config.serviceName}.test.type`,
      data: {
        key: "value",
      },
    });
  });
});
