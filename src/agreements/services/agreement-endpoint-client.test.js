import { afterEach, describe, expect, it, vi } from "vitest";
import { wreck } from "../../common/wreck.js";
import { callAgreementEndpoint } from "./agreement-endpoint-client.js";

vi.mock("../../common/wreck.js", () => ({
  wreck: {
    read: vi.fn(),
    request: vi.fn(),
  },
}));

describe("agreement endpoint client", () => {
  afterEach(() => {
    delete process.env.ARBITRARY_SERVICE_URL;
    delete process.env.ARBITRARY_SERVICE_HEADERS;
    delete process.env.ARBITRARY_SERVICE_TOKEN;
    vi.clearAllMocks();
  });

  it("calls endpoint services from flat service environment config", async () => {
    process.env.ARBITRARY_SERVICE_URL = "http://service.example";
    process.env.ARBITRARY_SERVICE_HEADERS =
      "Authorization: Bearer service-token, x-service-header: configured";
    wreck.read.mockResolvedValue({ ok: true });
    wreck.request.mockResolvedValue("response");

    const result = await callAgreementEndpoint({
      endpoint: {
        method: "POST",
        path: "/things/{thingId}",
        service: "ARBITRARY_SERVICE",
      },
      params: {
        BODY: { answer: 42 },
        PATH: { thingId: "thing 1" },
      },
    });

    expect(wreck.request).toHaveBeenCalledWith(
      "POST",
      "http://service.example/things/thing%201",
      {
        headers: {
          Authorization: "Bearer service-token",
          "Content-Type": "application/json",
          "x-service-header": "configured",
        },
        json: true,
        payload: { answer: 42 },
      },
    );
    expect(wreck.read).toHaveBeenCalledWith("response", { json: true });
    expect(result).toEqual({ ok: true });
  });

  it("resolves quoted headers and environment variable references", async () => {
    process.env.ARBITRARY_SERVICE_URL = "http://service.example";
    process.env.ARBITRARY_SERVICE_HEADERS =
      '"Authorization: Bearer ${ARBITRARY_SERVICE_TOKEN}"';
    process.env.ARBITRARY_SERVICE_TOKEN = "resolved-token";
    wreck.read.mockResolvedValue({ ok: true });
    wreck.request.mockResolvedValue("response");

    await callAgreementEndpoint({
      endpoint: {
        method: "GET",
        path: "/things",
        service: "ARBITRARY_SERVICE",
      },
    });

    expect(wreck.request).toHaveBeenCalledWith(
      "GET",
      "http://service.example/things",
      {
        headers: {
          Authorization: "Bearer resolved-token",
          "Content-Type": "application/json",
        },
        json: true,
      },
    );
  });

  it("rejects endpoint services without a configured URL", async () => {
    await expect(
      callAgreementEndpoint({
        endpoint: {
          method: "GET",
          path: "/things",
          service: "MISSING_SERVICE",
        },
      }),
    ).rejects.toThrow(
      "No URL configured for Agreement endpoint service: MISSING_SERVICE",
    );
  });
});
