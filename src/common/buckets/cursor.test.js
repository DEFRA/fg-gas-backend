import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "./cursor.js";
import { testBucket } from "./test-bucket.js";

const encode = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

const expectInvalid = (bucket, cursor) => {
  expect(() => decodeCursor(bucket, cursor)).toThrow(
    expect.objectContaining({
      output: expect.objectContaining({
        payload: expect.objectContaining({ reason: "INVALID_CURSOR" }),
      }),
    }),
  );
};

describe("cursor", () => {
  const dates = testBucket();
  const id = "66f000000000000000000001";
  const time = "2026-10-09T09:00:00.000Z";

  it("encodes the time as ISO and the id as a string", () => {
    const cursor = encodeCursor({
      t: new Date(time),
      i: ObjectId.createFromHexString(id),
    });

    expect(cursor).toBe(encode({ t: time, i: id }));
  });

  it("decodes to a Date and an ObjectId for a date bucket", () => {
    expect(decodeCursor(dates, encode({ t: time, i: id }))).toEqual({
      t: new Date(time),
      i: ObjectId.createFromHexString(id),
    });
  });

  it.each([
    ["text that is not base64url JSON", "x"],
    ["JSON null", encode(null)],
    ["a missing time", encode({ i: id })],
    ["a numeric time", encode({ t: 0, i: id })],
    ["a time that is not an instant", encode({ t: "yesterday", i: id })],
    ["a missing id", encode({ t: time })],
    ["an id that is not an ObjectId", encode({ t: time, i: "record-1" })],
  ])("refuses %s", (_, cursor) => {
    expectInvalid(dates, cursor);
  });

  it("refuses an empty string id", () => {
    expectInvalid(dates, encode({ t: time, i: "" }));
  });
});
