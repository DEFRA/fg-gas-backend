import { describe, expect, it } from "vitest";
import {
  DENIED,
  MALFORMED,
  NOT_A_ROOT,
  NOT_LISTED,
  answerListOf,
  isDeniedName,
  normalisedName,
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

  it.each([
    ["answers.$where"],
    ["$answers"],
    ["answers.$"],
    ["answers.$[]"],
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

  it.each([
    ["answers.applicant.Bank.SORTCODE"],
    ["_secret"],
    ["_id"],
    ["answers._internal"],
    ["metadata.valueDigest"],
    ["answers.sort_code"],
    ["answers.Sort-Code"],
    ["answers.access_token"],
    ["answers.dateOfBirth"],
    ["event.audit.details.conditions.digests"],
    ["event.ip"],
    ["definition.actions.url"],
    ["definitions.agreementsService.internalUrl"],
    ["definitions.grant.s3Key"],
    ["s3Bucket"],
  ])("refuses the denied %s", (text) => {
    expect(parsePath(text)).toBeNull();
  });
});

describe("isDeniedName", () => {
  it("compares names without case, _ or -", () => {
    expect(normalisedName("Sort_Code-x")).toBe("sortcodex");
    expect(isDeniedName("SORT_CODE")).toBe(true);
    expect(isDeniedName("business")).toBe(false);
  });
});

describe("pathProblem", () => {
  const lists = {
    roots: ["caseRef", "payload", "definition.phases", "agreement.clientRef"],
    answers: {
      at: "payload.answers",
      isListed: answerListOf(["applicant.business.name"]),
    },
  };

  it("allows a path at or under a root, and an answer on the list", () => {
    expect(pathProblem("caseRef", lists)).toBeNull();
    expect(pathProblem("definition.phases.stages.code", lists)).toBeNull();
    expect(pathProblem("agreement.clientRef", lists)).toBeNull();
    expect(pathProblem("payload.identifiers.sbi", lists)).toBeNull();
    expect(
      pathProblem("payload.answers.applicant.business.name", lists),
    ).toBeNull();
  });

  it.each([
    ["case ref", MALFORMED],
    ["payload..x", MALFORMED],
    ["payload.bank.x", DENIED],
    ["payload._x", DENIED],
    ["comments", NOT_A_ROOT],
    ["__proto__", MALFORMED],
    ["definition", NOT_A_ROOT],
    ["definition.endpoints", NOT_A_ROOT],
    ["definition.phasesX", NOT_A_ROOT],
    ["agreement.applicant.name", NOT_A_ROOT],
    ["caseRefs", NOT_A_ROOT],
    ["payload.answers.applicant.business", NOT_LISTED],
    ["payload.answers.other", NOT_LISTED],
    ["payload.answers", NOT_LISTED],
  ])("refuses %s as %s", (path, problem) => {
    expect(pathProblem(path, lists)).toBe(problem);
  });

  it("reads a position of a listed answer's list as the list", () => {
    const parcels = {
      ...lists,
      answers: { ...lists.answers, isListed: answerListOf(["parcels.id"]) },
    };

    expect(pathProblem("payload.answers.parcels.0.id", parcels)).toBeNull();
    expect(pathProblem("payload.answers.parcels.0.other", parcels)).toBe(
      NOT_LISTED,
    );
    expect(pathProblem("payload.answers.parcels.0", parcels)).toBe(NOT_LISTED);
  });

  it("opens everything below the roots when the source keeps no list", () => {
    expect(
      pathProblem("payload.answers.other", { roots: ["payload"] }),
    ).toBeNull();
  });
});

describe("answerListOf", () => {
  const isListed = answerListOf([
    "applicant.business.name",
    "landParcels",
    "applicant.bank",
    "",
  ]);

  it("allows a listed path, and any path below one", () => {
    expect(isListed("applicant.business.name")).toBe(true);
    expect(isListed("landParcels.parcelId")).toBe(true);
    expect(isListed("landParcels.0.areaHa")).toBe(true);
  });

  it.each([
    ["applicant.business"],
    ["applicant.business.nameX"],
    ["Applicant.business.name"],
    ["landParcelsX"],
    ["applicant.bank.sortCode"],
    ["applicant.business.name.__proto__"],
    [""],
  ])("refuses %s", (path) => {
    expect(isListed(path)).toBe(false);
  });

  it("allows nothing from an empty list", () => {
    expect(answerListOf([])("applicant.business.name")).toBe(false);
  });
});
