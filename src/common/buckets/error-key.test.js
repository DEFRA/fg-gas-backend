import { describe, expect, it } from "vitest";
import { toErrorKey } from "./error-key.js";

const keyOf = (message, name = "Error") => toErrorKey({ name, message });

describe("toErrorKey", () => {
  it("is null for a row with no recorded error", () => {
    expect(toErrorKey(null)).toBeNull();
    expect(toErrorKey(undefined)).toBeNull();
  });

  it("is the name alone when there is no message", () => {
    expect(toErrorKey({ name: "ClaimExpired" })).toBe("ClaimExpired");
    expect(toErrorKey({ name: "TypeError", message: "" })).toBe("TypeError");
    expect(toErrorKey({ message: "" })).toBe("Error");
  });

  it("keeps a message that holds nothing that varies", () => {
    expect(keyOf("claim expired before completion", "ClaimExpired")).toBe(
      "ClaimExpired: claim expired before completion",
    );
    expect(keyOf("Payload refused: TOO_LARGE")).toBe(
      "Error: Payload refused: TOO_LARGE",
    );
  });

  it.each([
    [
      'Application with clientRef "abc-123-xyz" not found',
      "Error: Application with clientRef <v> not found",
    ],
    [
      'Case with id "6acf62688ec1821be59b4d18" not found',
      "Error: Case with id <v> not found",
    ],
    ["Case not found: 6acf62688ec1821be59b4d18", "Error: Case not found: <id>"],
    [
      "Unable to handle inbox message 0b7c1d1e-0000-4000-8000-000000000001",
      "Error: Unable to handle inbox message <id>",
    ],
    [
      'gas inbox event "665f1c2e9a1b2c3d4e5f6aaa" not found',
      "Error: gas inbox event <v> not found",
    ],
    [
      "agreement FPTT000000001 has no payment",
      "Error: agreement <ref> has no payment",
    ],
    ["claim abc-123-claim-1 rejected", "Error: claim <ref> rejected"],
    [
      "sbi 106284736 frn 1102658375 crn 1100014934",
      "Error: sbi <n> frn <n> crn <n>",
    ],
    ["mail jo.bloggs+test@example.co.uk failed", "Error: mail <email> failed"],
    [
      "request to https://cw.example/actuators/cases/x?ref=abc-1 failed",
      "Error: request to <url> failed",
    ],
    ["connect ECONNREFUSED 10.0.0.12:3001", "Error: connect ECONNREFUSED <ip>"],
    [
      "Invalid semver version: 1.2.3",
      "Error: Invalid semver version: <version>",
    ],
    [
      "config grants/1.4.2-beta.1/definition.json missing",
      "Error: config <path> missing",
    ],
    [
      "lookup /api/v1/items?page=2&q=smith failed",
      "Error: lookup <path> failed",
    ],
  ])("takes out what varies: %s", (message, key) => {
    expect(keyOf(message)).toBe(key);
  });

  it("keeps a quoted field path and drops a quoted value", () => {
    expect(
      keyOf(
        '"data.sbi" with value "106284736" fails to match the required pattern',
      ),
    ).toBe(
      'Error: "data.sbi" with value <v> fails to match the required pattern',
    );
    expect(keyOf('"clientRef" is required')).toBe(
      'Error: "clientRef" is required',
    );
    expect(keyOf('"items[0].code" must be a string')).toBe(
      'Error: "items[0].code" must be a string',
    );
    expect(keyOf("'Smith' is not allowed")).toBe("Error: <v> is not allowed");
    expect(keyOf("`Jo Bloggs` is not allowed")).toBe(
      "Error: <v> is not allowed",
    );
  });

  it("drops a document a driver echoes, nested or not", () => {
    expect(
      keyOf(
        'E11000 duplicate key error collection: gas.applications index: clientRef_1_code_1 dup key: { clientRef: "abc-123", meta: { sbi: 106284736 } }',
        "MongoServerError",
      ),
    ).toBe(
      "MongoServerError: <ref> duplicate key error collection: gas.applications index: <ref> dup key: <v>",
    );
    expect(keyOf("bad items [1, 2, 3] and [{a: 1}]")).toBe(
      "Error: bad items <v> and <v>",
    );
  });

  it("gives two failures of the same kind the same key", () => {
    expect(keyOf('Grant with code "pigs-might-fly" not found')).toBe(
      keyOf('Grant with code "water-management" not found'),
    );
    expect(keyOf("Case not found: 6acf62688ec1821be59b4d18")).toBe(
      keyOf("Case not found: 6acf62688ec1821be59b4d19"),
    );
  });

  it("keeps a quoted path only where it labels what the message says of it", () => {
    expect(
      keyOf(
        '"applicant.business.name" with value "jo.bloggs" fails to match the required pattern',
      ),
    ).toBe(
      'Error: "applicant.business.name" with value <v> fails to match the required pattern',
    );
    expect(keyOf('set "jo.bloggs" as the owner')).toBe(
      "Error: set <v> as the owner",
    );
  });

  it("takes an apostrophe inside a word for an apostrophe, not a quote", () => {
    expect(keyOf("Can't process the application")).toBe(
      "Error: Can't process the application",
    );
  });

  it("takes out a file or route path, which can hold a name or a ref", () => {
    expect(
      keyOf("Invalid JSON in S3 object: uploads/jo.bloggs/claim.json"),
    ).toBe("Error: Invalid JSON in <ref> object: <path>");
  });

  it("collapses whitespace and caps the length", () => {
    expect(keyOf("  too\n\n many   spaces  ")).toBe("Error: too many spaces");
    expect(keyOf("x".repeat(500))).toHaveLength(120);
    expect(Array.from(keyOf(`${"x".repeat(111)}\u{1F600}z`))).toHaveLength(120);
  });

  it("leaves no digit run longer than three", () => {
    expect(
      keyOf("ids 1234 12345 4000-8000 a1b2c3d4 at 2026-10-14T10:00:00.000Z"),
    ).not.toMatch(/\d{4,}/);
  });
});
