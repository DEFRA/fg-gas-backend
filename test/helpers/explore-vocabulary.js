// A vocabulary as GAS builds it, small enough to read: the language tests
// and the corpus read queries against it.
const known = (path, type, extra = {}) => ({
  path,
  type,
  index: null,
  closed: false,
  within: null,
  ...extra,
});

const source = (name, size, { roots, paths, star, time, ...rest }) => ({
  name,
  label: name,
  service: "GAS",
  size,
  noun: { one: name.slice(0, -1), many: name },
  star,
  time,
  roots,
  answersAt: null,
  paths: new Map(paths.map((entry) => [entry.path, entry])),
  ...rest,
});

export const exploreVocabulary = () => ({
  sources: new Map([
    [
      "applications",
      source("applications", "big", {
        roots: [
          "clientRef",
          "code",
          "currentConfigVersion",
          "currentStatus",
          "createdAt",
          "identifiers",
          "phases",
          "refs",
        ],
        answersAt: "phases.answers",
        time: "createdAt",
        star: ["clientRef", "code", "currentStatus", "createdAt"],
        paths: [
          known("clientRef", "text", { index: "ref", scans: 1 }),
          known("identifiers.sbi", "text", { index: "ref", scans: 1 }),
          known("refs", "text", { index: "refs", scans: 1 }),
          known("code", "text", { index: "fact" }),
          known("currentConfigVersion", "text", {
            index: "fact",
            within: "code",
          }),
          known("currentStatus", "text"),
          known("createdAt", "date", { index: "time", stored: "isoString" }),
          known("phases.answers.applicant.business.name", "text"),
          known("phases.answers.parcels.parcelId", "text"),
          known("phases.answers.parcels.areaHa", "number"),
          known("phases.answers.agentDeclaration", "boolean"),
        ],
      }),
    ],
    [
      "cases",
      source("cases", "big", {
        roots: [
          "caseRef",
          "workflowCode",
          "currentStatus",
          "createdAt",
          "payload",
        ],
        answersAt: "payload.answers",
        time: "createdAt",
        star: ["caseRef", "workflowCode", "currentStatus", "createdAt"],
        paths: [
          known("caseRef", "text", { index: "ref", scans: 1 }),
          known("workflowCode", "text", { index: "fact" }),
          known("currentStatus", "text"),
          known("createdAt", "date", { index: "time", stored: "date" }),
          known("payload.answers.applicant.business.name", "text"),
        ],
      }),
    ],
    [
      "events",
      source("events", "big", {
        roots: [
          "eventType",
          "status",
          "publicationDate",
          "lastError",
          "refs",
          "service",
          "box",
        ],
        time: "publicationDate",
        star: ["publicationDate", "eventType", "status"],
        paths: [
          known("eventType", "text", { index: "fact", closed: true }),
          known("status", "text", { index: "fact", closed: true }),
          known("service", "text", { index: "box", closed: true }),
          known("box", "text", { index: "box", closed: true }),
          known("refs", "text", { index: "refs", scans: 1 }),
          known("publicationDate", "date", { index: "time", stored: "date" }),
          known("lastError.message", "text"),
        ],
      }),
    ],
    [
      "agreements",
      source("agreements", "small", {
        roots: ["agreementNumber", "state", "totalAmountPence"],
        time: "createdAt",
        star: ["agreementNumber", "state", "totalAmountPence"],
        paths: [
          known("agreementNumber", "text"),
          known("state", "text"),
          known("totalAmountPence", "number"),
        ],
      }),
    ],
    [
      "payments",
      source("payments", "small", {
        roots: ["sbi", "payments", "totalAmountPence"],
        time: "createdAt",
        star: ["sbi", "payments.status", "totalAmountPence"],
        paths: [
          known("sbi", "text"),
          known("payments.status", "text"),
          known("totalAmountPence", "number"),
        ],
      }),
    ],
  ]),
  unavailable: new Map([
    ["grants", new Error("not in this vocabulary")],
    ["workflows", new Error("not in this vocabulary")],
  ]),
});
