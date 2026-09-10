import { describe, expect, it } from "vitest";
import {
  CURSOR_VERSION,
  SOURCE_KEYS,
  decodeCompositeCursor,
  encodeCompositeCursor,
  encodeSourceCursor,
  sortKeyFor,
} from "./event-cursor.js";

const ID_A = "665f1c2e9a1b2c3d4e5f6a7b";
const ID_B = "665f1c2e9a1b2c3d4e5f6a7c";

const decode = (value) =>
  JSON.parse(Buffer.from(value, "base64url").toString());
const encode = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

const slices = () => ({
  gasInbox: encodeSourceCursor("gasInbox", {
    cursorValue: "2026-06-16T10:00:00.000Z",
    id: ID_A,
  }),
  gasOutbox: encodeSourceCursor("gasOutbox", {
    cursorValue: "2026-06-16T09:00:00.000Z",
    id: ID_B,
  }),
  cwInbox: null,
  cwOutbox: null,
});

describe("sortKeyFor", () => {
  it("keys inbox sources on eventTime and outbox sources on publicationDate", () => {
    expect(sortKeyFor("gasInbox")).toEqual("eventTime");
    expect(sortKeyFor("cwInbox")).toEqual("eventTime");
    expect(sortKeyFor("gasOutbox")).toEqual("publicationDate");
    expect(sortKeyFor("cwOutbox")).toEqual("publicationDate");
  });
});

describe("encodeSourceCursor", () => {
  it("encodes a per-source inbox cursor as base64url { eventTime, _id }", () => {
    const cursor = encodeSourceCursor("gasInbox", {
      cursorValue: "2026-06-16T10:00:00.000Z",
      id: ID_A,
    });

    expect(decode(cursor)).toEqual({
      eventTime: "2026-06-16T10:00:00.000Z",
      _id: ID_A,
    });
  });

  it("encodes a per-source outbox cursor as base64url { publicationDate, _id }", () => {
    const cursor = encodeSourceCursor("cwOutbox", {
      cursorValue: "2026-06-16T10:00:00.000Z",
      id: ID_A,
    });

    expect(decode(cursor)).toEqual({
      publicationDate: "2026-06-16T10:00:00.000Z",
      _id: ID_A,
    });
  });

  it("encodes a null cursor value as null rather than omitting the key", () => {
    const cursor = encodeSourceCursor("gasInbox", {
      cursorValue: null,
      id: ID_A,
    });

    expect(decode(cursor)).toEqual({ eventTime: null, _id: ID_A });
    expect(Object.keys(decode(cursor))).toContain("eventTime");
  });

  it("passes a non-canonical ISO string through verbatim", () => {
    const cursor = encodeSourceCursor("gasInbox", {
      cursorValue: "2026-06-16T10:00:00Z",
      id: ID_A,
    });

    expect(decode(cursor).eventTime).toEqual("2026-06-16T10:00:00Z");
  });
});

describe("decodeCompositeCursor", () => {
  it("round-trips a full composite cursor through encode then decode", () => {
    const original = slices();

    expect(decodeCompositeCursor(encodeCompositeCursor(original))).toEqual(
      original,
    );
  });

  it("stamps the cursor version on the envelope", () => {
    expect(decode(encodeCompositeCursor(slices())).v).toEqual(CURSOR_VERSION);
  });

  it("decodes an absent cursor to four null slices", () => {
    expect(decodeCompositeCursor(undefined)).toEqual({
      gasInbox: null,
      gasOutbox: null,
      cwInbox: null,
      cwOutbox: null,
    });
    expect(decodeCompositeCursor("")).toEqual(decodeCompositeCursor(undefined));
    expect(Object.keys(decodeCompositeCursor())).toEqual(SOURCE_KEYS);
  });

  it("rejects a tampered cursor with Boom 400 Cannot decode cursor", () => {
    expect(() => decodeCompositeCursor("not-a-cursor")).toThrow(
      "Cannot decode cursor",
    );

    try {
      decodeCompositeCursor("not-a-cursor");
    } catch (error) {
      expect(error.output.statusCode).toEqual(400);
    }
  });

  it("rejects a cursor whose v is 2", () => {
    expect(() =>
      decodeCompositeCursor(encode({ v: 2, gasInbox: null })),
    ).toThrow("Cannot decode cursor");
  });

  it("rejects a cursor with no v", () => {
    expect(() => decodeCompositeCursor(encode({ gasInbox: null }))).toThrow(
      "Cannot decode cursor",
    );
  });

  it("rejects a cursor that decodes to something other than an object", () => {
    expect(() => decodeCompositeCursor(encode([1, 2, 3]))).toThrow(
      "Cannot decode cursor",
    );
    expect(() => decodeCompositeCursor(encode(42))).toThrow(
      "Cannot decode cursor",
    );
  });

  it("rejects a composite whose gasInbox slice is not a decodable per-source cursor", () => {
    expect(() =>
      decodeCompositeCursor(encode({ v: 1, gasInbox: "%%%%" })),
    ).toThrow("Cannot decode cursor");
  });

  it("rejects a per-source slice that is not a string", () => {
    expect(() =>
      decodeCompositeCursor(encode({ v: 1, gasInbox: { _id: ID_A } })),
    ).toThrow("Cannot decode cursor");
  });

  it("rejects a per-source slice missing _id", () => {
    expect(() =>
      decodeCompositeCursor(
        encode({ v: 1, gasInbox: encode({ eventTime: null }) }),
      ),
    ).toThrow("Cannot decode cursor");
  });

  it("rejects a per-source slice whose _id is not 24 hex characters", () => {
    expect(() =>
      decodeCompositeCursor(
        encode({ v: 1, gasInbox: encode({ eventTime: null, _id: "zzz" }) }),
      ),
    ).toThrow("Cannot decode cursor");
  });

  it("rejects a per-source slice keyed on the wrong sort field", () => {
    expect(() =>
      decodeCompositeCursor(
        encode({
          v: 1,
          gasInbox: encode({ publicationDate: null, _id: ID_A }),
        }),
      ),
    ).toThrow("Cannot decode cursor");
  });

  it("accepts absent slice keys as null", () => {
    expect(decodeCompositeCursor(encode({ v: 1 }))).toEqual({
      gasInbox: null,
      gasOutbox: null,
      cwInbox: null,
      cwOutbox: null,
    });
  });
});
