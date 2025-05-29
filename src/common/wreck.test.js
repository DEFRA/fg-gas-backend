import { getTraceId } from "@defra/hapi-tracing";
import http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "./config.js";
import { wreck } from "./wreck.js";

vi.mock("@defra/hapi-tracing");

describe("wreck", () => {
  let server;

  beforeEach(() => {
    server = http
      .createServer((req, res) => {
        res.writeHead(200, {
          "Content-Type": "application/json",
        });
        res.end(JSON.stringify(req.headers));
      })
      .listen(0);
  });

  afterEach(() => {
    server.close();
  });

  it("adds a trace id header when in async scope", async () => {
    getTraceId.mockReturnValue("test-trace-id");

    const port = server.address().port;
    const response = await wreck.get(`http://localhost:${port}`, {
      json: true,
    });

    expect(response.payload[config.tracingHeader]).toEqual("test-trace-id");
  });

  it("does not add a trace id header when not in async scope", async () => {
    const port = server.address().port;
    const response = await wreck.get(`http://localhost:${port}`, {
      json: true,
    });

    expect(response.payload[config.tracingHeader]).toBeUndefined();
  });
});
