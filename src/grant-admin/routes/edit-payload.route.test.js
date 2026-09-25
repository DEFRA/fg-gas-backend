import { describe, expect, it, vi } from "vitest";
import { logger } from "../../common/logger.js";
import { editPayloadRequestSchema } from "../schemas/edit-payload-request.schema.js";
import { editPayloadUseCase } from "../use-cases/edit-payload.use-case.js";
import { editPayloadRoute } from "./edit-payload.route.js";

vi.mock("../use-cases/edit-payload.use-case.js");

const ID = "665f1c2e9a1b2c3d4e5f6a7b";

const RESULT = {
  payloadRevision: 1,
  changedPaths: ["/data/sheetId"],
  changedPathsTruncated: false,
  beforeHash: "b".repeat(64),
  afterHash: "a".repeat(64),
};

const call = (overrides = {}) =>
  editPayloadRoute.handler({
    params: { service: "gas", box: "inbox", id: ID },
    payload: { payload: { id: "evt-1" }, note: "fixed", revision: 0 },
    auth: { credentials: { service: "admin-ui" } },
    headers: { "x-actor": "donatas" },
    ...overrides,
  });

const validate = (part, value) =>
  editPayloadRoute.options.validate[part].validate(value);

describe("editPayloadRoute", () => {
  it("is a POST on /grant-admin/events/{service}/{box}/{id}/payload", () => {
    expect(editPayloadRoute.method).toBe("POST");
    expect(editPayloadRoute.path).toBe(
      "/grant-admin/events/{service}/{box}/{id}/payload",
    );
  });

  it("takes the default service auth strategy", () => {
    expect(editPayloadRoute.options.auth).toBeUndefined();
  });

  it("rejects an id that is not a 24-hex ObjectId", () => {
    expect(
      validate("params", { service: "gas", box: "inbox", id: "../x" }).error,
    ).toBeDefined();
  });

  it("insists on an operator", () => {
    expect(validate("headers", {}).error).toBeDefined();
    expect(validate("headers", { "x-actor": "donatas" }).error).toBeUndefined();
  });

  it("lets a body through a little over the payload bound, for the note", () => {
    expect(editPayloadRoute.options.payload.maxBytes).toBe(
      256 * 1024 + 16 * 1024,
    );
  });

  it("logs a refused body by its message alone, and answers 400 with it", () => {
    const warn = vi.spyOn(logger, "warn");
    const { error } = editPayloadRequestSchema.validate({
      payload: { email: "old@example.com" },
      note: "n".repeat(501),
      revision: 0,
    });

    let thrown;
    try {
      editPayloadRoute.options.validate.failAction({}, {}, error);
    } catch (e) {
      thrown = e;
    }

    expect(thrown.output.statusCode).toBe(400);
    expect(thrown.message).toBe(error.message);
    expect(JSON.stringify(thrown)).not.toContain("example.com");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("example.com");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("nnnn");
  });

  it("passes the params, the edit and the authenticated caller to the use case", async () => {
    editPayloadUseCase.mockResolvedValue(RESULT);

    await call({
      params: { service: "caseworking", box: "outbox", id: ID },
      headers: { "x-actor": "UTF-8''%C5%81ukasz" },
    });

    expect(editPayloadUseCase).toHaveBeenCalledWith({
      service: "caseworking",
      box: "outbox",
      id: ID,
      payload: { id: "evt-1" },
      note: "fixed",
      revision: 0,
      caller: "admin-ui",
      actor: "Łukasz",
    });
  });

  // The hashes are for the audit event alone.
  it("answers with the revision and the changed paths only", async () => {
    editPayloadUseCase.mockResolvedValue(RESULT);

    expect(await call()).toEqual({
      payloadRevision: 1,
      changedPaths: ["/data/sheetId"],
      changedPathsTruncated: false,
    });
  });

  it("describes its answer with the response schema", () => {
    expect(
      editPayloadRoute.options.response.schema.validate({
        payloadRevision: 1,
        changedPaths: ["", "/a"],
        changedPathsTruncated: true,
      }).error,
    ).toBeUndefined();
  });
});
