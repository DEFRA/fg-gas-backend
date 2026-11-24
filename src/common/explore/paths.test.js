import { describe, expect, it } from "vitest";
import {
  MALFORMED,
  hasDollarSegment,
  isDollarSegment,
  parsePath,
  pathProblem,
} from "./paths.js";

describe("parsePath", () => {
  it("reads a stored path as its segments", () => {
    expect(parsePath("phases.answers.applicant.business.name")).toEqual([
      "phases",
      "answers",
      "applicant",
      "business",
      "name",
    ]);
    expect(parsePath("identifiers.sbi")).toEqual(["identifiers", "sbi"]);
  });

  it("takes a list's position, digits, keys with - and map keys of data", () => {
    expect(parsePath("phases.0.code")).toEqual(["phases", "0", "code"]);
    expect(parsePath("agreements.FPTT123456789.latestStatus")).toEqual([
      "agreements",
      "FPTT123456789",
      "latestStatus",
    ]);
    expect(parsePath("lastError.x-y")).toEqual(["lastError", "x-y"]);
  });

  it("keeps names an object inherits elsewhere as ordinary names", () => {
    expect(parsePath("toString.x")).toEqual(["toString", "x"]);
    expect(parsePath("hasOwnProperty")).toEqual(["hasOwnProperty"]);
  });

  it("takes _id, keys starting _ and keys starting $ after the first", () => {
    expect(parsePath("_id")).toEqual(["_id"]);
    expect(parsePath("answers._internal")).toEqual(["answers", "_internal"]);
    expect(parsePath("phases.questions.$schema")).toEqual([
      "phases",
      "questions",
      "$schema",
    ]);
    expect(parsePath("a.$ref.$id")).toEqual(["a", "$ref", "$id"]);
  });

  it.each([
    ["$answers"],
    ["$schema.x"],
    ["answers.$"],
    ["answers.$[]"],
    ["answers.$[x]"],
    ["answers.$**"],
    ["answers.$$x"],
    ["answers..name"],
    [".answers"],
    ["answers."],
    ["answers.name[0]"],
    ["parcels[*].id"],
    ["answers.name "],
    ["answers.na me"],
    [""],
    ["constructor.x"],
    ["answers.__proto__"],
    ["answers.prototype"],
    ["a.b.c.d.e.f.g.h.i.j.k.l.m"],
    [`answers.${"a".repeat(200)}`],
    [42],
    [undefined],
  ])("refuses %s", (text) => {
    expect(parsePath(text)).toBeNull();
  });
});

describe("isDollarSegment", () => {
  it("tells a key starting $ from any other", () => {
    expect(isDollarSegment("$schema")).toBe(true);
    expect(isDollarSegment("schema")).toBe(false);
    expect(hasDollarSegment("phases.questions.$schema.type")).toBe(true);
    expect(hasDollarSegment("phases.questions")).toBe(false);
  });
});

describe("pathProblem", () => {
  it.each([
    ["caseRef"],
    ["_id"],
    ["payload._x"],
    ["payload.bank.sortCode"],
    ["comments.text"],
    ["event.ip"],
    ["definition.actions.url"],
    ["definitions.grant.s3Key"],
    ["phases.questions.$schema"],
  ])("reads %s, as every well-formed path is read", (path) => {
    expect(pathProblem(path)).toBeNull();
  });

  it.each([
    ["case ref"],
    ["payload..x"],
    ["__proto__"],
    ["$schema"],
    ["payload.$"],
  ])("refuses %s as malformed", (path) => {
    expect(pathProblem(path)).toBe(MALFORMED);
  });
});
