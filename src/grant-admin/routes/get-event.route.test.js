import { describe, expect, it, vi } from "vitest";
import { getEventUseCase } from "../use-cases/get-event.use-case.js";
import { getEventRoute } from "./get-event.route.js";

vi.mock("../use-cases/get-event.use-case.js");

const ID = "665f1c2e9a1b2c3d4e5f6a7b";

const validateParams = (params) =>
  getEventRoute.options.validate.params.validate(params);

const aRequest = (overrides = {}) => ({
  params: { service: "gas", box: "inbox", id: ID },
  auth: { credentials: { service: "grants-ui", tokenId: "t-1" } },
  ...overrides,
});

describe("getEventRoute", () => {
  it("is a GET on /grant-admin/events/{service}/{box}/{id}", () => {
    expect(getEventRoute.method).toBe("GET");
    expect(getEventRoute.path).toBe("/grant-admin/events/{service}/{box}/{id}");
  });

  it("takes the default service auth strategy", () => {
    expect(getEventRoute.options.auth).toBeUndefined();
  });

  it("declares the detail response schema", () => {
    expect(getEventRoute.options.response.schema.describe().flags.label).toBe(
      "EventDetail",
    );
  });

  it("accepts both services and both boxes", () => {
    for (const service of ["gas", "caseworking"]) {
      for (const box of ["inbox", "outbox"]) {
        expect(validateParams({ service, box, id: ID }).error).toBeUndefined();
      }
    }
  });

  it("rejects an unknown service", () => {
    expect(
      validateParams({ service: "payments", box: "inbox", id: ID }).error,
    ).toBeDefined();
  });

  it("rejects an unknown box", () => {
    expect(
      validateParams({ service: "gas", box: "deadletter", id: ID }).error,
    ).toBeDefined();
  });

  it("rejects an id that is not a 24-hex ObjectId", () => {
    expect(
      validateParams({ service: "gas", box: "inbox", id: "nope" }).error,
    ).toBeDefined();
  });

  it("passes the params and the authenticated caller to the use case", async () => {
    const detail = { id: ID };
    getEventUseCase.mockResolvedValue(detail);

    const result = await getEventRoute.handler(aRequest());

    expect(getEventUseCase).toHaveBeenCalledWith({
      service: "gas",
      box: "inbox",
      id: ID,
      caller: "grants-ui",
    });
    expect(result).toBe(detail);
  });

  it("sends a null caller when there are no credentials", async () => {
    getEventUseCase.mockResolvedValue({ id: ID });

    await getEventRoute.handler(aRequest({ auth: undefined }));

    expect(getEventUseCase).toHaveBeenCalledWith(
      expect.objectContaining({ caller: null }),
    );
  });
});
