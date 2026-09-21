import { describe, expect, it } from "vitest";
import { purgeEventRequestSchema } from "./purge-event-request.schema.js";

const validate = (body) => purgeEventRequestSchema.validate(body);

describe("purgeEventRequestSchema", () => {
  it("is labelled PurgeEventRequest", () => {
    expect(purgeEventRequestSchema.describe().flags.label).toBe(
      "PurgeEventRequest",
    );
  });

  it.each(["BROKEN_PAYLOAD", "SENT_IN_ERROR"])(
    "takes %s on its own, because the code says it all",
    (reasonCode) => {
      expect(validate({ reasonCode }).error).toBeUndefined();
    },
  );

  it("takes a note alongside a code that does not need one", () => {
    expect(
      validate({ reasonCode: "SENT_IN_ERROR", note: "raised twice" }).error,
    ).toBeUndefined();
  });

  it("rejects a reason code it does not know", () => {
    expect(validate({ reasonCode: "JUST_BECAUSE" }).error).toBeDefined();
  });

  it("rejects a body with no reason at all", () => {
    expect(validate({}).error).toBeDefined();
    expect(validate({ note: "a note and nothing else" }).error).toBeDefined();
  });

  it("rejects anything else in the body", () => {
    expect(
      validate({ reasonCode: "OTHER", note: "n", status: "COMPLETED" }).error,
    ).toBeDefined();
  });
});

// `OTHER` says nothing on its own, so the note is what carries the reason.
describe("purgeEventRequestSchema note", () => {
  const longNote = (length) => "n".repeat(length);

  it("requires a note for OTHER", () => {
    expect(validate({ reasonCode: "OTHER" }).error).toBeDefined();
    expect(
      validate({ reasonCode: "OTHER", note: "superseded by FGP-1236" }).error,
    ).toBeUndefined();
  });

  it("refuses an empty, blank or null note for OTHER, as it refuses none", () => {
    expect(validate({ reasonCode: "OTHER", note: "" }).error).toBeDefined();
    expect(validate({ reasonCode: "OTHER", note: "   " }).error).toBeDefined();
    expect(validate({ reasonCode: "OTHER", note: null }).error).toBeDefined();
  });

  // The admin leaves the key out when the note is empty; an empty or null one
  // arriving anyway means the same thing.
  it.each([["  "], [""], [null]])(
    "reads %j as no note where none is required",
    (note) => {
      const { error, value } = validate({
        reasonCode: "BROKEN_PAYLOAD",
        note,
      });

      expect(error).toBeUndefined();
      expect(value.note).toBeUndefined();
    },
  );

  it("takes a note of exactly 500 characters", () => {
    expect(
      validate({ reasonCode: "OTHER", note: longNote(500) }).error,
    ).toBeUndefined();
  });

  it("rejects 501 characters", () => {
    expect(
      validate({ reasonCode: "OTHER", note: longNote(501) }).error,
    ).toBeDefined();
  });

  it("trims before it measures, and stores what it measured", () => {
    const { error, value } = validate({
      reasonCode: "OTHER",
      note: `  ${longNote(500)}  `,
    });

    expect(error).toBeUndefined();
    expect(value.note).toBe(longNote(500));
  });

  it("rejects a note that is not a string", () => {
    expect(validate({ reasonCode: "OTHER", note: 42 }).error).toBeDefined();
    expect(
      validate({ reasonCode: "BROKEN_PAYLOAD", note: 42 }).error,
    ).toBeDefined();
  });
});
