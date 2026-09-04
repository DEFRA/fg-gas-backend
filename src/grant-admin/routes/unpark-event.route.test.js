import { describe, expect, it, vi } from "vitest";
import { unparkEventUseCase } from "../use-cases/park-event.use-case.js";
import { unparkEventRoute } from "./unpark-event.route.js";

vi.mock("../use-cases/park-event.use-case.js");

const ID = "665f1c2e9a1b2c3d4e5f6a7b";

const handle = (request = {}) =>
  unparkEventRoute.handler({
    params: { service: "caseworking", box: "outbox", id: ID },
    headers: {},
    auth: { credentials: { service: "admin-ui" } },
    ...request,
  });

describe("unparkEventRoute", () => {
  it("is a POST on the unpark path", () => {
    expect(unparkEventRoute.method).toBe("POST");
    expect(unparkEventRoute.path).toBe(
      "/grant-admin/events/{service}/{box}/{id}/unpark",
    );
  });

  it("takes no body - unparking says nothing new about the row", () => {
    expect(unparkEventRoute.options.validate.payload).toBeUndefined();
  });

  it("passes the params, the caller and the actor to the use case", async () => {
    unparkEventUseCase.mockResolvedValue({ event: {} });

    await handle({ headers: { "x-actor": "donatas" } });

    expect(unparkEventUseCase).toHaveBeenCalledWith({
      service: "caseworking",
      box: "outbox",
      id: ID,
      caller: "admin-ui",
      actor: "donatas",
    });
  });

  it("validates the actor header", () => {
    expect(unparkEventRoute.options.validate.headers).toBeDefined();
  });
});
