import { describe, expect, it } from "vitest";
import {
  editPayloadRequestSchema,
  editPayloadResponseSchema,
} from "./edit-payload-request.schema.js";

const aBody = (overrides = {}) => ({
  payload: { id: "evt-1", data: { sheetId: "SX0679" } },
  note: "sheetId was sent as a number",
  revision: 0,
  ...overrides,
});

const validate = (body) => editPayloadRequestSchema.validate(body);

describe("editPayloadRequestSchema", () => {
  it("takes a payload, a note and a revision", () => {
    expect(validate(aBody()).error).toBeUndefined();
  });

  it("trims the note", () => {
    expect(validate(aBody({ note: "  fixed  " })).value.note).toBe("fixed");
  });

  it.each([
    ["no note", { note: undefined }],
    ["an empty note", { note: "" }],
    ["a whitespace note", { note: "   " }],
    ["a null note", { note: null }],
    ["a 501-character note", { note: "n".repeat(501) }],
    ["no revision", { revision: undefined }],
    ["a negative revision", { revision: -1 }],
    ["a fractional revision", { revision: 1.5 }],
    ["no payload", { payload: undefined }],
    ["an array payload", { payload: [1] }],
    ["a string payload", { payload: "text" }],
    ["a null payload", { payload: null }],
  ])("refuses %s", (_, overrides) => {
    expect(validate(aBody(overrides)).error).toBeDefined();
  });

  it("takes a 500-character note", () => {
    expect(validate(aBody({ note: "n".repeat(500) })).error).toBeUndefined();
  });

  it("takes any keys inside the payload", () => {
    expect(
      validate(aBody({ payload: { anything: { goes: [1, null] } } })).error,
    ).toBeUndefined();
  });

  it("never quotes a value in its messages", () => {
    const { error } = editPayloadRequestSchema.validate(
      aBody({ payload: ["old@example.com"], note: "n".repeat(501) }),
      { abortEarly: false },
    );

    expect(error.details).toHaveLength(2);
    expect(error.message).not.toContain("example.com");
    expect(error.message).not.toContain("nnn");
  });
});

describe("editPayloadResponseSchema", () => {
  it("names the revision, the paths and whether they were cut", () => {
    expect(
      editPayloadResponseSchema.validate({
        payloadRevision: 2,
        changedPaths: ["/a"],
        changedPathsTruncated: false,
      }).error,
    ).toBeUndefined();
  });

  it("carries nothing else", () => {
    expect(
      editPayloadResponseSchema.validate({
        payloadRevision: 2,
        changedPaths: ["/a"],
        changedPathsTruncated: false,
        beforeHash: "x",
      }).error,
    ).toBeDefined();
  });
});
