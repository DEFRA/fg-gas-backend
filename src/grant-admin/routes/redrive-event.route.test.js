import { describe, expect, it, vi } from "vitest";
import { redriveEventUseCase } from "../use-cases/redrive-event.use-case.js";
import { redriveEventRoute } from "./redrive-event.route.js";

vi.mock("../use-cases/redrive-event.use-case.js");

const ID = "665f1c2e9a1b2c3d4e5f6a7b";

const noContent = { response: () => ({ code: () => null }) };

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
    redriveEventUseCase.mockResolvedValue(undefined);
    const code = vi.fn().mockReturnValue("no content");
    const h = { response: vi.fn().mockReturnValue({ code }) };

    const result = await redriveEventRoute.handler(
      {
        params: { service: "caseworking", box: "outbox", id: ID },
        auth: { credentials: { service: "admin-ui" } },
        headers: {},
      },
      h,
    );

    expect(redriveEventUseCase).toHaveBeenCalledWith({
      service: "caseworking",
      box: "outbox",
      id: ID,
      caller: "admin-ui",
      actor: null,
    });
    expect(h.response).toHaveBeenCalledWith();
    expect(code).toHaveBeenCalledWith(204);
    expect(result).toBe("no content");
  });
});

describe("redriveEventRoute actor", () => {
  it("reads the operator from the x-actor header", async () => {
    redriveEventUseCase.mockResolvedValue(undefined);

    await redriveEventRoute.handler(
      {
        params: { service: "gas", box: "inbox", id: ID },
        auth: { credentials: { service: "admin-ui" } },
        headers: { "x-actor": "donatas" },
      },
      noContent,
    );

    expect(redriveEventUseCase).toHaveBeenCalledWith(
      expect.objectContaining({ actor: "donatas" }),
    );
  });

  it("reads an encoded operator back into their own name", async () => {
    redriveEventUseCase.mockResolvedValue(undefined);

    await redriveEventRoute.handler(
      {
        params: { service: "gas", box: "inbox", id: ID },
        auth: { credentials: { service: "admin-ui" } },
        headers: { "x-actor": "UTF-8''%C5%81ukasz" },
      },
      noContent,
    );

    expect(redriveEventUseCase).toHaveBeenCalledWith(
      expect.objectContaining({ actor: "Łukasz" }),
    );
  });

  it("validates the header, so an over-long actor is a 400", () => {
    expect(redriveEventRoute.options.validate.headers).toBeDefined();
  });
});
