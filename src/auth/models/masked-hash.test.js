import { BSON, Binary, Double, Int32, Long, ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import {
  documentOf,
  objectIdElement,
  stringElement,
} from "../../../test/helpers/raw-bson.js";
import { isMaskedTokenRow } from "./masked-hash.js";

const HASH = "a1".repeat(32);
const TOKEN_ID = new ObjectId("6650c1f2a9e4b1d07c20bd91");

const row = (fields = {}) => ({
  _id: TOKEN_ID,
  id: "a1a••••••1a1",
  clientId: "grants-ui",
  tokenHint: "ab12",
  expiresAt: new Date("2027-01-01T00:00:00Z"),
  createdAt: new Date("2026-01-01T00:00:00Z"),
  createdBy: "Ops Person",
  revokedAt: null,
  revokedBy: null,
  ...fields,
});

const bytesOf = (fields) =>
  BSON.serialize(row(fields), { ignoreUndefined: true });

describe("isMaskedTokenRow", () => {
  it("passes a stored row with its hash masked", () => {
    expect(isMaskedTokenRow(bytesOf())).toBe(true);
  });

  it.each([
    ["an int32", new Int32(1)],
    ["an int64", Long.fromNumber(2)],
    ["a double", new Double(1.5)],
    ["a boolean", true],
    ["null", null],
    ["a date", new Date(0)],
    ["an ObjectId", new ObjectId()],
    ["text", "anything"],
  ])("passes a field holding %s", (_, value) => {
    expect(isMaskedTokenRow(bytesOf({ extra: value }))).toBe(true);
  });

  it.each([
    ["a hash in base64 text", Buffer.from(HASH, "hex").toString("base64")],
    ["half a hash", HASH.slice(0, 32)],
  ])("passes %s, as it shows no hash", (_, value) => {
    expect(isMaskedTokenRow(bytesOf({ extra: value }))).toBe(true);
  });

  it.each([
    ["an unmasked id", { id: HASH }],
    ["a whole hash in another field", { createdBy: `by ${HASH}` }],
    ["a whole hash in capitals", { revokedBy: HASH.toUpperCase() }],
    ["a hash as a key", { [HASH]: 1 }],
    ["a Binary(32) beside id", { id2: new Binary(Buffer.alloc(32, 7), 0) }],
    ["a nested hash", { nested: { h: HASH } }],
    ["a nested document of nothing", { nested: {} }],
    ["a list holding a hash", { list: [HASH] }],
    ["a missing id", { id: undefined }],
    ["an id not a string", { id: 7 }],
    ["an id masked otherwise", { id: "a1a••••1a1" }],
    ["an _id not an ObjectId", { _id: "6650c1f2a9e4b1d07c20bd91" }],
  ])("refuses a row with %s", (_, fields) => {
    expect(isMaskedTokenRow(bytesOf(fields))).toBe(false);
  });

  it("refuses a row with a second id, which a decoded copy loses", () => {
    const twice = documentOf([
      objectIdElement("_id", TOKEN_ID),
      stringElement("id", "a1a••••••1a1"),
      stringElement("id", HASH),
    ]);

    expect(BSON.deserialize(twice).id).toBe(HASH);
    expect(isMaskedTokenRow(twice)).toBe(false);

    const maskedLast = documentOf([
      objectIdElement("_id", TOKEN_ID),
      stringElement("id", HASH.slice(0, 63)),
      stringElement("id", "a1a••••••1a1"),
    ]);

    expect(isMaskedTokenRow(maskedLast)).toBe(false);
  });

  it.each([
    ["bytes that aren't BSON", Buffer.from("not bson")],
    ["a cut row", bytesOf().subarray(0, 20)],
    ["nothing", Buffer.alloc(0)],
  ])("refuses %s", (_, buf) => {
    expect(isMaskedTokenRow(buf)).toBe(false);
  });
});
