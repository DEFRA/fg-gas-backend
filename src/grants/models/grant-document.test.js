import { describe, expect, it } from "vitest";
import { GrantDocument } from "./grant-document.js";
import { Grant } from "./grant.js";

const aGrant = (startDate) =>
  new Grant({
    code: "woodland",
    version: "1.0.0",
    metadata: { description: "Woodland", startDate },
    actions: [],
    phases: [],
  });

describe("GrantDocument", () => {
  it("stores a start date published as Mongo extended JSON as the ISO string of its instant", () => {
    expect(
      new GrantDocument(aGrant({ $date: "2100-01-01T00:00:00Z" })).metadata,
    ).toEqual({
      description: "Woodland",
      startDate: "2100-01-01T00:00:00.000Z",
    });
  });

  it("stores a Date start date as the ISO string of its instant", () => {
    expect(
      new GrantDocument(aGrant(new Date("2100-01-01T00:00:00.000Z"))).metadata
        .startDate,
    ).toBe("2100-01-01T00:00:00.000Z");
  });

  it("stores a start date published as a string as published", () => {
    expect(
      new GrantDocument(aGrant("2026-04-01T00:00:00Z")).metadata.startDate,
    ).toBe("2026-04-01T00:00:00Z");
  });

  it("refuses an extended JSON start date that is no instant", () => {
    expect(() => new GrantDocument(aGrant({ $date: "soon" }))).toThrow(
      expect.objectContaining({
        message: 'Grant start date "soon" is not an instant',
        output: expect.objectContaining({ statusCode: 500 }),
      }),
    );
  });

  it("refuses a start date published as a string that is no instant", () => {
    expect(() => new GrantDocument(aGrant("soon"))).toThrow(
      expect.objectContaining({
        message: 'Grant start date "soon" is not an instant',
        output: expect.objectContaining({ statusCode: 500 }),
      }),
    );
  });
});
