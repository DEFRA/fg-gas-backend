import { describe, expect, it, vi } from "vitest";
import { redriveEventUseCase } from "../use-cases/redrive-event.use-case.js";
import { redriveEventRoute } from "./redrive-event.route.js";

vi.mock("../use-cases/redrive-event.use-case.js");

const ID = "665f1c2e9a1b2c3d4e5f6a7b";

const validateParams = (params) =>
  redriveEventRoute.options.validate.params.validate(params);

describe("redriveEventRoute", () => {
  it("is a POST on /grant-admin/events/{service}/{box}/{id}/redrive", () => {
    expect(redriveEventRoute.method).toBe("POST");
    expect(redriveEventRoute.path).toBe(
      "/grant-admin/events/{service}/{box}/{id}/redrive",
    );
  });

  it("takes the default service auth strategy", () => {
    expect(redriveEventRoute.options.auth).toBeUndefined();
  });

  it("answers with one list-shaped row under `event`", () => {
    expect(
      redriveEventRoute.options.response.schema.describe().flags.label,
    ).toBe("RedriveEventResponse");
  });

  it("rejects an id that is not a 24-hex ObjectId", () => {
    expect(
      validateParams({ service: "gas", box: "inbox", id: "../../etc" }).error,
    ).toBeDefined();
  });

  it("rejects an unknown service", () => {
    expect(
      validateParams({ service: "elsewhere", box: "inbox", id: ID }).error,
    ).toBeDefined();
  });

  it("passes the params and the authenticated caller to the use case", async () => {
    const response = { event: { id: ID } };
    redriveEventUseCase.mockResolvedValue(response);

    const result = await redriveEventRoute.handler({
      params: { service: "caseworking", box: "outbox", id: ID },
      auth: { credentials: { service: "admin-ui" } },
      headers: {},
    });

    expect(redriveEventUseCase).toHaveBeenCalledWith({
      service: "caseworking",
      box: "outbox",
      id: ID,
      caller: "admin-ui",
      actor: null,
    });
    expect(result).toBe(response);
  });
});

describe("redriveEventRoute actor", () => {
  it("reads the operator from the x-actor header", async () => {
    redriveEventUseCase.mockResolvedValue({ event: {} });

    await redriveEventRoute.handler({
      params: { service: "gas", box: "inbox", id: ID },
      auth: { credentials: { service: "admin-ui" } },
      headers: { "x-actor": "donatas" },
    });

    expect(redriveEventUseCase).toHaveBeenCalledWith(
      expect.objectContaining({ actor: "donatas" }),
    );
  });

  it("validates the header, so an over-long actor is a 400", () => {
    expect(redriveEventRoute.options.validate.headers).toBeDefined();
  });
});
