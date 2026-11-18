import { describe, expect, it } from "vitest";
import { GAS_EXPLORE_SOURCES } from "../../../test/helpers/explore-sources.js";
import { SOURCES } from "./language/allowlist.js";
import {
  CW_SOURCES,
  buildVocabulary,
  publicVocabulary,
  readsCaseworking,
  sharedVersion,
} from "./vocabulary.js";

const own = [
  {
    name: "applications",
    label: "Applications",
    service: "GAS",
    size: "big",
    noun: { one: "application", many: "applications" },
    time: "createdAt",
    star: ["clientRef"],
    roots: ["clientRef", "phases"],
    answersAt: "phases.answers",
    paths: [
      { path: "clientRef", type: "text", index: { ref: "ref" } },
      { path: "phases.answers.referenceNumber", type: "text" },
    ],
  },
];

const answers = [
  { path: "applicant.business.name", type: "text" },
  { path: "referenceNumber", type: "number" },
  { path: "landParcels.areaHa", type: "number" },
  { path: "agentDeclaration" },
];

const knownPath = (path, extra = {}) => ({
  path,
  index: null,
  closed: false,
  within: null,
  ...extra,
});

const cw = {
  versions: [2, 7],
  sources: [
    {
      name: "cases",
      label: "Cases",
      service: "CW",
      size: "big",
      noun: { one: "case", many: "cases" },
      time: "createdAt",
      star: ["caseRef"],
      roots: ["caseRef", "payload"],
      answersAt: "payload.answers",
      listedAt: "payload.answers",
      answerPaths: ["applicant.business", "landParcels", "selectedParcelId"],
      paths: [
        knownPath("caseRef", { type: "text", index: "ref" }),
        knownPath("currentStatus", {
          values: [{ value: "RECEIVED", label: "Received" }],
        }),
      ],
    },
    { name: "events", service: "CW", paths: [] },
    { name: "applications", service: "GAS", paths: [] },
  ],
};

const pathsOf = (vocabulary, source) => [
  ...vocabulary.sources.get(source).paths.keys(),
];

describe("buildVocabulary", () => {
  it("holds GAS's sources and Caseworking's, each with its answer paths after its own", () => {
    const vocabulary = buildVocabulary({ own, answers, cw });

    expect([...vocabulary.sources.keys()]).toEqual(["applications", "cases"]);
    expect(pathsOf(vocabulary, "applications")).toEqual([
      "clientRef",
      "phases.answers.referenceNumber",
      "phases.answers.applicant.business.name",
      "phases.answers.landParcels.areaHa",
      "phases.answers.agentDeclaration",
    ]);
    expect(
      vocabulary.sources
        .get("applications")
        .paths.get("phases.answers.referenceNumber"),
    ).toMatchObject({ type: "text" });
    expect(
      vocabulary.sources
        .get("applications")
        .paths.get("phases.answers.landParcels.areaHa"),
    ).toMatchObject({ type: "number", index: null });
    expect(vocabulary.cwVersion).toBe(2);
    expect(vocabulary.unavailable.size).toBe(0);
  });

  it("gives cases the grants' answer paths on Caseworking's list, and the list's own", () => {
    const vocabulary = buildVocabulary({ own, answers, cw });

    expect(pathsOf(vocabulary, "cases")).toEqual([
      "caseRef",
      "currentStatus",
      "payload.answers.applicant.business.name",
      "payload.answers.landParcels.areaHa",
      "payload.answers.applicant.business",
      "payload.answers.landParcels",
      "payload.answers.selectedParcelId",
    ]);
    expect(
      vocabulary.sources.get("cases").isListed("landParcels.0.areaHa"),
    ).toBe(true);
    expect(vocabulary.sources.get("cases").isListed("agentDeclaration")).toBe(
      false,
    );
  });

  it("gives cases no answers when Caseworking lists none", () => {
    const vocabulary = buildVocabulary({
      own,
      answers,
      cw: {
        ...cw,
        sources: [{ ...cw.sources[0], answerPaths: undefined }],
      },
    });

    expect(pathsOf(vocabulary, "cases")).toEqual(["caseRef", "currentStatus"]);
  });

  it("names Caseworking's sources unavailable, with why, when it didn't answer", () => {
    const failure = new Error("Caseworking didn't answer");
    const vocabulary = buildVocabulary({
      own,
      answers,
      cw: null,
      cwFailure: failure,
    });

    expect([...vocabulary.sources.keys()]).toEqual(["applications"]);
    expect(vocabulary.unavailable.get("cases")).toBe(failure);
    expect(vocabulary.unavailable.get("workflows")).toBe(failure);
  });
});

describe("sharedVersion", () => {
  it("is the highest Query version both read, or null", () => {
    expect(sharedVersion([2, 9])).toBe(2);
    expect(sharedVersion([1])).toBeNull();
  });
});

describe("publicVocabulary", () => {
  const anyone = () => true;

  it("lists only the sources the caller may query", () => {
    const built = buildVocabulary({ own, answers, cw });
    const all = publicVocabulary(built, new Map(), anyone);
    const some = publicVocabulary(
      built,
      new Map(),
      ({ name }) => name !== "applications",
    );

    expect(some.sources.map(({ name }) => name)).toEqual(
      all.sources
        .map(({ name }) => name)
        .filter((name) => name !== "applications"),
    );
  });

  it("tells the editor each path, its type and whether it is indexed", () => {
    const vocabulary = publicVocabulary(
      buildVocabulary({ own, answers, cw }),
      new Map(),
      anyone,
    );

    expect(vocabulary.sources[0]).toEqual({
      name: "applications",
      label: "Applications",
      time: "createdAt",
      paths: [
        { path: "clientRef", type: "text", indexed: true },
        {
          path: "phases.answers.referenceNumber",
          type: "text",
          indexed: false,
        },
        {
          path: "phases.answers.applicant.business.name",
          type: "text",
          indexed: false,
        },
        {
          path: "phases.answers.landParcels.areaHa",
          type: "number",
          indexed: false,
        },
        { path: "phases.answers.agentDeclaration", indexed: false },
      ],
    });
  });

  it("gives closed paths their known values, GAS's as loaded and Caseworking's as described", () => {
    const vocabulary = publicVocabulary(
      buildVocabulary({ own, answers, cw }),
      new Map([
        [
          "applications",
          new Map([["clientRef", [{ value: "a", label: "A" }]]]),
        ],
      ]),
      anyone,
    );

    expect(vocabulary.sources[0].paths[0].values).toEqual([
      { value: "a", label: "A" },
    ]);
    expect(vocabulary.sources[0].paths[1]).not.toHaveProperty("values");
    expect(vocabulary.sources[1].paths[1].values).toEqual([
      { value: "RECEIVED", label: "Received" },
    ]);
  });

  it("lists the sources in the order a query names them", () => {
    const vocabulary = publicVocabulary(
      buildVocabulary({ own, answers, cw }),
      new Map(),
      anyone,
    );
    const names = vocabulary.sources.map(({ name }) => name);

    expect(names).toEqual(
      [...names].sort((a, b) => SOURCES.indexOf(a) - SOURCES.indexOf(b)),
    );
  });
});

describe("readsCaseworking", () => {
  it.each([
    ["db.cases.find()", true],
    ["// first\ndb.workflows.find()", true],
    ["db.events.find({ service: 'GAS' })", true],
    ["db.applications.find()", false],
    ["db.payments", false],
    ["cases.find()", false],
    ["", false],
  ])("%s: %s", (text, reads) => {
    expect(readsCaseworking(text)).toBe(reads);
  });
});

describe("the sources a query may name", () => {
  it("are GAS's own and Caseworking's, each once", () => {
    expect([...SOURCES].sort()).toEqual(
      [...GAS_EXPLORE_SOURCES.map(({ name }) => name), ...CW_SOURCES].sort(),
    );
  });
});
