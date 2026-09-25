import { describe, expect, it, vi } from "vitest";
import { purgeEventUseCase } from "../use-cases/purge-event.use-case.js";
import { purgeEventRoute } from "./purge-event.route.js";

vi.mock("../use-cases/purge-event.use-case.js");

const ID = "665f1c2e9a1b2c3d4e5f6a7b";

const noContent = { response: () => ({ code: () => null }) };

const validateParams = (params) =>
  purgeEventRoute.options.validate.params.validate(params);

const call = (overrides = {}) =>
  purgeEventRoute.handler(
    {
      params: { service: "gas", box: "inbox", id: ID },
      payload: { reasonCode: "BROKEN_PAYLOAD" },
      auth: { credentials: { service: "admin-ui" } },
      headers: { "x-actor": "donatas" },
      ...overrides,
    },
    noContent,
  );

describe("purgeEventRoute", () => {
  it("is a POST on /grant-admin/events/{service}/{box}/{id}/purge", () => {
    expect(purgeEventRoute.method).toBe("POST");
    expect(purgeEventRoute.path).toBe(
      "/grant-admin/events/{service}/{box}/{id}/purge",
    );
  });

  it("takes the default service auth strategy", () => {
    expect(purgeEventRoute.options.auth).toBeUndefined();
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

  it("validates the body, so an unknown reason code is a 400", () => {
    expect(
      purgeEventRoute.options.validate.payload.validate({
        reasonCode: "JUST_BECAUSE",
      }).error,
    ).toBeDefined();
  });

  it("passes the params, the reason and the authenticated caller to the use case", async () => {
    purgeEventUseCase.mockResolvedValue(undefined);

    await call({
      params: { service: "caseworking", box: "outbox", id: ID },
      payload: { reasonCode: "SENT_IN_ERROR", note: "raised twice" },
    });

    expect(purgeEventUseCase).toHaveBeenCalledWith({
      service: "caseworking",
      box: "outbox",
      id: ID,
      reasonCode: "SENT_IN_ERROR",
      note: "raised twice",
      caller: "admin-ui",
      actor: "donatas",
    });
  });

  // The admin omits the key when the note is empty; the row stores null.
  it("turns an absent note into a null one", async () => {
    purgeEventUseCase.mockResolvedValue(undefined);

    await call();

    expect(purgeEventUseCase).toHaveBeenCalledWith(
      expect.objectContaining({ note: null }),
    );
  });

  it("answers 204 with no body", async () => {
    purgeEventUseCase.mockResolvedValue(undefined);
    const code = vi.fn().mockReturnValue("no content");
    const h = { response: vi.fn().mockReturnValue({ code }) };

    const result = await purgeEventRoute.handler(
      {
        params: { service: "gas", box: "inbox", id: ID },
        payload: { reasonCode: "BROKEN_PAYLOAD" },
        auth: { credentials: { service: "admin-ui" } },
        headers: { "x-actor": "donatas" },
      },
      h,
    );

    expect(h.response).toHaveBeenCalledWith();
    expect(code).toHaveBeenCalledWith(204);
    expect(result).toBe("no content");
  });
});

describe("purgeEventRoute actor", () => {
  it("reads the operator from the x-actor header", async () => {
    purgeEventUseCase.mockResolvedValue(undefined);

    await call({ headers: { "x-actor": "donatas" } });

    expect(purgeEventUseCase).toHaveBeenCalledWith(
      expect.objectContaining({ actor: "donatas" }),
    );
  });

  it("reads an encoded operator back into their own name", async () => {
    purgeEventUseCase.mockResolvedValue(undefined);

    await call({ headers: { "x-actor": "UTF-8''%C5%81ukasz" } });

    expect(purgeEventUseCase).toHaveBeenCalledWith(
      expect.objectContaining({ actor: "Łukasz" }),
    );
  });

  it("validates the header, so an over-long actor is a 400", () => {
    expect(
      purgeEventRoute.options.validate.headers.validate({
        "x-actor": "x".repeat(129),
      }).error,
    ).toBeDefined();
  });

  // A purge is audited on both backends; neither has anyone else to name.
  it("insists on an operator, so a purge that names nobody is a 400", () => {
    expect(
      purgeEventRoute.options.validate.headers.validate({}).error,
    ).toBeDefined();
    expect(
      purgeEventRoute.options.validate.headers.validate({ "x-actor": " " })
        .error,
    ).toBeDefined();
  });
});
