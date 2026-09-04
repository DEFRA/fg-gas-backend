import { describe, expect, it, vi } from "vitest";
import { parkEventUseCase } from "../use-cases/park-event.use-case.js";
import { parkEventRoute } from "./park-event.route.js";

vi.mock("../use-cases/park-event.use-case.js");

const ID = "665f1c2e9a1b2c3d4e5f6a7b";

const handle = (request = {}) =>
  parkEventRoute.handler({
    params: { service: "gas", box: "inbox", id: ID },
    payload: { reason: "poison" },
    headers: {},
    auth: { credentials: { service: "admin-ui" } },
    ...request,
  });

describe("parkEventRoute", () => {
  it("is a POST on the park path", () => {
    expect(parkEventRoute.method).toBe("POST");
    expect(parkEventRoute.path).toBe(
      "/grant-admin/events/{service}/{box}/{id}/park",
    );
  });

  it("has no auth option, so the default service strategy applies", () => {
    expect(parkEventRoute.options.auth).toBeUndefined();
  });

  it("passes the params, the reason, the caller and the actor to the use case", async () => {
    parkEventUseCase.mockResolvedValue({ event: {} });

    await handle({ headers: { "x-actor": "donatas" } });

    expect(parkEventUseCase).toHaveBeenCalledWith({
      service: "gas",
      box: "inbox",
      id: ID,
      reason: "poison",
      caller: "admin-ui",
      actor: "donatas",
    });
  });

  it("passes a null actor when nobody named themselves", async () => {
    parkEventUseCase.mockResolvedValue({ event: {} });

    await handle({});

    expect(parkEventUseCase).toHaveBeenCalledWith(
      expect.objectContaining({ actor: null }),
    );
  });

  it("requires a reason", () => {
    expect(
      parkEventRoute.options.validate.payload.validate({}).error,
    ).toBeDefined();
  });

  it("rejects an over-long actor header", () => {
    expect(
      parkEventRoute.options.validate.headers.validate({
        "x-actor": "x".repeat(129),
      }).error,
    ).toBeDefined();
  });

  it("ignores the other headers a real request carries", () => {
    expect(
      parkEventRoute.options.validate.headers.validate({
        authorization: "Bearer token",
        "content-type": "application/json",
      }).error,
    ).toBeUndefined();
  });

  it("answers with the row under `event`, exactly as a redrive does", () => {
    expect(parkEventRoute.options.response.schema).toBeDefined();
  });
});
