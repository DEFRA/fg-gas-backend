import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { exploreVocabulary } from "../../../../test/helpers/explore-vocabulary.js";
import { PATTERN_MESSAGES } from "../../../common/explore/pattern.js";
import { keepsRules } from "../../../common/explore/query-rules.js";
import {
  QUERY_VERSIONS,
  isWithinLimits,
  querySchema,
} from "../../../common/explore/query-schema.js";
import { CHECK_MESSAGES } from "../check.js";
import { SOURCES } from "./allowlist.js";
import { lex } from "./lex.js";
import { OUTLINE_MESSAGES, outlineProblem } from "./outline.js";
import { MAX_LENGTH, MESSAGES as PARSE_MESSAGES } from "./parse.js";
import { readQuery } from "./query.js";
import { READ_MESSAGES } from "./read.js";

// The corpus GPA checks its copy of the editor against: each query with how
// GAS cuts it and GAS's outcome. Regenerate it with
// UPDATE_EXPLORE_CORPUS=1 npx vitest run src/grant-admin/explore/language/corpus.test.js
const CORPUS = new URL("./corpus.json", import.meta.url);

const many = (n, item) =>
  Array.from({ length: n }, (_, i) => item(i)).join(", ");

// Shape problems GAS names and the editor, on purpose, doesn't: it says
// nothing about an empty query (there is nothing to warn about while typing),
// and its method table is a plain object, so it takes constructor for one.
const EDITOR_DIFFERS = new Map([
  ["", "the editor is quiet on empty text"],
  ["// only a comment", "the editor is quiet on empty text"],
  [
    "db.cases.constructor()",
    "the editor's method table is a plain object, so it takes constructor",
  ],
  [
    "'db'.applications.find()",
    "the editor reads the head's text, not its kind",
  ],
]);

const N = "'phases.answers.applicant.business.name'";
const A = "'phases.answers.parcels.areaHa'";

const TOKEN_FORMS = [
  "db.applications.find()",
  "db.applications.find();",
  `db.applications.find({ ${N}: 'Hilltop' })`,
  `db.applications.find({ "phases.answers.applicant.business.name": "Hilltop" })`,
  `db.applications.find({ ${N}: 'it\\'s' })`,
  `db.applications.find({ ${N}: "say \\"hi\\"" })`,
  `db.applications.find({ ${N}: 'a\\\\b' })`,
  "db.applications.find({ 'code': 'x', \"currentStatus\": 'y' })",
  `db.applications.find({ ${N}: /hill/i })`,
  `db.applications.find({ ${N}: /^hill\\b.*farm$/imsu })`,
  `db.applications.find({ code: 'a', ${N}: /x/m })`,
  `db.applications.find({ ${N}: { $in: [/a/] } })`,
  "db.applications.distinct(/x/)",
  `db.applications.find({ ${A}: { $gt: -4.5, $lte: 10 } })`,
  `db.applications.find({ ${A}: { $gte: 0.25 } })`,
  "// a note\ndb.applications.find()",
  "db.applications.find() // all of them",
  "db.applications // where\n  .find({ code: 'a' }) // which\n  .limit(5)",
  "db.applications.find({ code: 'a', }, { clientRef: 1, },)",
  "db.applications.find({ code: { $in: ['a', 'b',] } })",
  "db.applications.find({ code: { $exists: true }, 'identifiers.sbi': null })",
  "db.applications.find({ code: { $exists: 1 }, 'identifiers.sbi': { $exists: 0 } })",
  "db.applications.find({ 'phases.answers.agentDeclaration': true, currentStatus: { $in: [false, null] } })",
  "db.applications.find({ createdAt: { $gte: ISODate('2026-10-01'), $lt: Date('2026-11-01T00:00:00Z') } })",
  "db.applications.find({ createdAt: { $gte: '2026-10-01' } })",
  "db.applications.find({ $and: [{ code: 'a' }], $or: [{ 'identifiers.sbi': '1' }, { refs: 'sbi:2' }], $nor: [{ currentStatus: 'x' }] })",
  `db.applications.find({ ${N}: { $not: /hill/ }, ${A}: { $not: { $gt: 4 } } })`,
  "db.applications.find({ code: { $ne: 'a', $nin: ['b'] } })",
  `db.applications.find({ ${N}: { $regex: /hill/ } })`,
  `db.applications.find({}, { _id: 0, clientRef: 1, 'identifiers.sbi': true, name: '$phases.answers.applicant.business.name', parcels: { $size: '$phases.answers.parcels.parcelId' }, total: { $sum: '$phases.answers.parcels.areaHa' }, first: { $min: '$createdAt' }, last: { $max: '$createdAt' } })`,
  "db.applications.find({}, { 'phases.0.code': 1, 'phases.answers.x-y': 1 })",
  "db.applications.find().sort({ createdAt: -1 }).limit(10)",
  "db.applications.find().limit(10).sort({ createdAt: -1 })",
  "db.applications.countDocuments()",
  "db.applications.distinct('code')",
  "db.applications.distinct('phases.answers.applicant.business.name')",
  "db.agreements.aggregate([{ $match: { state: 'x' } }, { $project: { agreementNumber: 1 } }, { $sort: { agreementNumber: 1 } }, { $limit: 3 }])",
  "db.agreements.aggregate([{ $group: { _id: '$state', n: { $count: {} }, low: { $min: '$totalAmountPence' } } }, { $sort: { _id: 1 } }])",
  "db.applications.countDocuments({ clientRef: { $in: ['a', 'b'] } })",
  "db.applications.countDocuments({ $or: [{ clientRef: 'a' }, { 'identifiers.sbi': 'b' }] })",
  `db.applications.find({ ${N}: /\\ud83d\\ude00/u })`,
  `db.applications.find({ ${N}: { $regex: 'hill', $options: 'i' } })`,
  `db.applications.find({ ${N}: '$hill' })`,
  `db.applications.find({ ${N}: // a note\n/hill/ })`,
];

// Spec section 13's checks, on this corpus's vocabulary.
const SPEC_CHECKS = [
  `db.applications.find({ ${N}: /hilltop/i }, { clientRef: 1 })`,
  "db.applications.find({ refs: 'sbi:200000001' }, { clientRef: 1 })",
  "db.cases.aggregate([{ $match: { workflowCode: 'frps-private-beta' } }, { $group: { _id: '$currentStatus', cases: { $sum: 1 } } }])",
  "db.events.aggregate([{ $match: { status: 'DEAD_LETTER' } }, { $group: { _id: '$eventType', events: { $sum: 1 }, latest: { $max: '$publicationDate' } } }, { $sort: { events: -1 } }])",
  "db.applications.aggregate([{ $match: { code: 'woodland' } }, { $unwind: '$phases' }, { $group: { _id: '$phases.code', phases: { $sum: 1 } } }])",
  "db.cases.aggregate([{ $match: { workflowCode: 'woodland' } }, { $unwind: { path: '$payload.answers.parcels', preserveNullAndEmptyArrays: true } }, { $project: { caseRef: 1, parcel: '$payload.answers.parcels.parcelId' } }, { $sort: { parcel: 1 } }, { $limit: 20 }])",
  "db.applications.aggregate([{ $unwind: '$phases' }, { $unwind: '$phases.answers.parcels' }, { $group: { _id: '$phases.answers.parcels.parcelId', n: { $sum: 1 } } }])",
  "db.cases.distinct('currentStatus', { workflowCode: 'woodland' })",
  "db.payments.countDocuments({ sbi: '200000455' })",
  "db.applications.find({}, { clientRef: 1, colour: 1 })",
  `db.applications.find({ ${N}: 'hill })`,
  `db.applications.find({ ${A}: { $where: 1 } })`,
];

const SHAPE_REFUSALS = [
  "db.applications.find({ # })",
  `db.applications.find({ ${N}: 'hill })`,
  `db.applications.find({ ${N}: "hill })`,
  `db.applications.find({ ${N}: /hill })`,
  "db.applications.find({ a: 1 }))",
  "db.applications.find({ a: [1 })",
  "db.applications.find({ a: 1 ",
  "applications.find()",
  "'db'.applications.find()",
  "db applications.find()",
  "db",
  "db.",
  "db.users.find()",
  "db.cases.findOne({})",
  "db.cases.constructor()",
  "db.cases.find({}).skip(5)",
  "db.cases",
  `db.applications.find({ ${A}: { $where: 1 } })`,
  "db.events.aggregate([{ $lookup: {} }])",
  "",
  "// only a comment",
];

const LITERAL_REFUSALS = [
  `db.applications.find({ ${N}: '${"x".repeat(MAX_LENGTH)}' })`,
  `db.applications.find({ code: { $in: [${"1,".repeat(600)}] } })`,
  `db.applications.find(${"[".repeat(9)}${"]".repeat(9)})`,
  "db.applications.find({ code: 'a', code: 'b' })",
  "db.applications.find({ code: 'a' currentStatus: 'b' })",
  "db.applications.find({ code 'a' })",
  "db.applications.find({ 1: 'a' })",
  "db.applications.find({ code: x })",
  "db.applications.find({ identifiers.sbi: '1' })",
  "db.applications.find({ createdAt: ISODate(1) })",
  "db.applications.find({ createdAt: ISODate('2026-10-01' 1) })",
  "db.applications.find({ createdAt: Date })",
  "db.applications.find().sort({}).sort({})",
  "db.applications.find() x",
  "db.applications.find();;",
  `db.applications.find({ ${A}: 9007199254740993 })`,
  `db.applications.find(${"[".repeat(8)}1${"]".repeat(8)})`,
  "db.applications.find().",
  "db.applications.find()..sort({ createdAt: -1 })",
];

const MEANING_REFUSALS = [
  "db.applications.find({ colour: 1 })",
  "db.applications.find({ anything: /9238/ })",
  "db.applications.find({ 'phases..x': 1 })",
  "db.applications.find({ 'phases.$': 1 })",
  "db.applications.find({ 'identifiers.nino': 'x' })",
  "db.applications.find({}, { _id: 1 })",
  "db.cases.find({ 'comments.text': /x/ })",
  "db.cases.find({}, { a: '$payload.answers.other' })",
  "db.cases.find({ createdAt: { $gte: '2026-10-01' } })",
  "db.applications.find({}, { n: '$nope' })",
  "db.applications.find({}, { n: { $size: 'phases' } })",
  "db.applications.find({}, { clientRef: 0 })",
  "db.applications.find({}, { clientRef: 2 })",
  "db.applications.find({}, [1])",
  `db.applications.find({}, { ${"x".repeat(65)}: '$clientRef' })`,
  `db.agreements.find({}, { ${many(21, (n) => `c${n}: '$state'`)} })`,
  "db.agreements.find({}, { agreementNumber: 1, state: 1, totalAmountPence: 1, a: '$state', b: '$state' }).limit(5000)",
  "db.applications.find([])",
  "db.applications.find({ $gt: 4 })",
  "db.applications.find({ '$where': 4 })",
  `db.applications.find({ ${A}: { big: 1 } })`,
  "db.applications.find({ code: { $eq: [1] } })",
  "db.applications.find({ code: { $in: 'a' } })",
  "db.applications.find({ code: ['a'] })",
  "db.applications.find({ code: { $exists: 2 } })",
  "db.agreements.find({}, { '': '$state' })",
  "db.applications.find({ code: { $regex: 4 } })",
  "db.applications.find({ code: { $options: 'i' } })",
  "db.applications.find({ code: { $regex: /a/i, $options: 'i' } })",
  "db.applications.find({ code: { $regex: 'a', $options: 1 } })",
  "db.applications.find({ code: { $not: 4 } })",
  `db.applications.find({ ${A}: { $gt: null } })`,
  "db.applications.find({ createdAt: ISODate('2026-02-30') })",
  "db.events.find({ service: 'Caseworking' })",
  "db.events.find({ box: 'sideways' })",
  `db.applications.find({ ${N}: '${"x".repeat(201)}' })`,
  `db.applications.find({ code: { $in: [${many(51, () => "'a'")}] } })`,
  `db.applications.find({ $or: [${many(31, (n) => `{ code: '${n}' }`)}] })`,
  "db.applications.find({ $or: {} })",
  "db.applications.find({ $or: [{}] })",
  `db.applications.find({ ${N}: /(?=a)/ })`,
  `db.applications.find({ ${N}: /(a)\\1/ })`,
  `db.applications.find({ ${N}: /a/g })`,
  `db.applications.find({ ${N}: /a{1,30}/ })`,
  `db.applications.find({ ${N}: /((a{20}){20}){20}/ })`,
  `db.applications.find({ ${N}: /a[/ })`,
  `db.applications.find({ ${N}: /[\\B]/ })`,
  `db.applications.find({ ${N}: { $regex: '${"a".repeat(65)}' } })`,
  "db.applications.find().sort({ createdAt: -1, clientRef: 1 })",
  "db.applications.find().sort({ createdAt: 'desc' })",
  "db.applications.find().sort({ colour: 1 })",
  "db.applications.find().limit(0)",
  "db.applications.find({}, {}, {})",
  "db.payments.countDocuments().limit(3)",
  "db.payments.countDocuments({}, {})",
  "db.payments.distinct()",
  "db.payments.distinct(1)",
  "db.payments.distinct('bank.iban')",
  "db.agreements.aggregate([])",
  "db.agreements.aggregate([{ $match: {} }]).limit(3)",
  "db.agreements.aggregate([{ $match: {}, $limit: 1 }])",
  "db.agreements.aggregate([{ $in: [] }])",
  "db.agreements.aggregate([{ $limit: 1 }, { $match: {} }])",
  "db.agreements.aggregate([{ $group: { n: { $sum: 1 } } }])",
  "db.agreements.aggregate([{ $group: { _id: 'state' } }])",
  "db.agreements.aggregate([{ $group: 1 }])",
  "db.agreements.aggregate([{ $group: { _id: '$state', n: { $gt: '$totalAmountPence' } } }])",
  "db.agreements.aggregate([{ $group: { _id: '$state', n: { $sum: 2 } } }])",
  "db.agreements.aggregate([{ $group: { _id: '$state', n: { $count: 1 } } }])",
  "db.agreements.aggregate([{ $group: { _id: '$state' } }, { $sort: { agreementNumber: 1 } }])",
  "db.agreements.aggregate([{ $limit: 'x' }])",
  "db.agreements.aggregate([{ $match: {} }, { $unwind: '$items' }, { $unwind: '$parcels' }, { $unwind: '$actions' }, { $unwind: '$payload' }, { $limit: 1 }])",
  "db.applications.aggregate([{ $unwind: '$phases' }, { $unwind: '$phases' }, { $unwind: '$phases' }, { $unwind: '$phases' }, { $unwind: '$phases.answers.parcels' }])",
  "db.agreements.aggregate([{ $unwind: 'items' }])",
  "db.agreements.aggregate([{ $unwind: { preserveNullAndEmptyArrays: true } }])",
  "db.agreements.aggregate([{ $unwind: { path: '$items', includeArrayIndex: 'n' } }])",
  "db.cases.aggregate([{ $unwind: { path: '$payload', preserveNullAndEmptyArrays: 1 } }])",
  "db.agreements.aggregate([{ $group: { _id: '$state' } }, { $unwind: '$items' }])",
  "db.cases.aggregate([{ $unwind: '$comments' }])",
  "db.agreements.aggregate([{ $group: { _id: '$state', $match: { $sum: 1 } } }])",
  "db.workflows.find()",
  `db.applications.aggregate([{ $match: { ${N}: /hill/ } }, { $group: { _id: '$currentStatus', n: { $sum: 1 } } }])`,
  `db.applications.countDocuments({ ${A}: { $gt: 4 } })`,
  "db.applications.countDocuments({ code: { $in: [null, 'a'] } })",
  "db.applications.countDocuments({ clientRef: '' })",
  "db.applications.distinct('currentStatus', { $or: [{ code: 'a' }, { code: 'b' }] })",
  "db.applications.find({ currentConfigVersion: '1' }).sort({ clientRef: 1 })",
];

const vocabulary = exploreVocabulary();

const outcomeOf = (text) => {
  try {
    const { error } = readQuery(text, vocabulary);

    return error ?? "ok";
  } catch (failure) {
    return { message: failure.message, unavailable: true };
  }
};

const isShape = (text, outcome) => {
  const shape = outlineProblem(text, lex(text), SOURCES);

  return outcome !== "ok" && JSON.stringify(shape) === JSON.stringify(outcome);
};

const entryOf = (text) => {
  const outcome = outcomeOf(text);

  return {
    text,
    tokens: lex(text).map(({ k, at, end }) => ({ k, at, end })),
    outcome,
    ...(isShape(text, outcome) && { shape: true }),
    ...(EDITOR_DIFFERS.has(text) && {
      editorDiffers: EDITOR_DIFFERS.get(text),
    }),
  };
};

const editorVocabulary = () => ({
  sources: SOURCES.map((name) => ({
    name,
    fields: [...(vocabulary.sources.get(name)?.paths.keys() ?? [])].map(
      (path) => ({ name: path }),
    ),
  })),
  open: true,
});

const corpusNow = () => ({
  vocabulary: editorVocabulary(),
  entries: [
    ...new Set([
      ...TOKEN_FORMS,
      ...SPEC_CHECKS,
      ...SHAPE_REFUSALS,
      ...LITERAL_REFUSALS,
      ...MEANING_REFUSALS,
    ]),
  ].map(entryOf),
});

// One entry a line, so a change to one shows as one line.
const written = ({ vocabulary: words, entries }) =>
  [
    "{",
    `  "vocabulary": ${JSON.stringify(words)},`,
    '  "entries": [',
    entries.map((entry) => `    ${JSON.stringify(entry)}`).join(",\n"),
    "  ]",
    "}",
    "",
  ].join("\n");

if (process.env.UPDATE_EXPLORE_CORPUS === "1") {
  writeFileSync(CORPUS, written(corpusNow()));
}

const MARK = "\u0001";

// A message with marks where it varies; a list of names is one mark.
const MARKED_ARGS = [
  [MARK, MARK, MARK],
  [MARK, { name: MARK, roots: [MARK] }],
  [[MARK]],
];

const marked = (message) => {
  for (const args of MARKED_ARGS) {
    try {
      return message(...args);
    } catch {
      // The next arguments may fit.
    }
  }

  return String(message);
};

// A message, its varying parts as wildcards.
const patternOf = (message) => {
  const text =
    typeof message === "function" ? marked(message) : String(message);
  const escaped = text
    .split(MARK)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[\\s\\S]+");

  return new RegExp(`^${escaped}$`);
};

const ALL_MESSAGES = {
  ...Object.fromEntries(
    Object.entries(OUTLINE_MESSAGES).map(([k, v]) => [`outline.${k}`, v]),
  ),
  ...Object.fromEntries(
    Object.entries(PARSE_MESSAGES).map(([k, v]) => [`parse.${k}`, v]),
  ),
  ...Object.fromEntries(
    Object.entries(READ_MESSAGES).map(([k, v]) => [`read.${k}`, v]),
  ),
  ...Object.fromEntries(
    Object.entries(CHECK_MESSAGES).map(([k, v]) => [`check.${k}`, v]),
  ),
  ...Object.fromEntries(
    Object.entries(PATTERN_MESSAGES).map(([k, v]) => [`pattern.${k}`, v]),
  ),
};

describe("the corpus", () => {
  const corpus = corpusNow();

  it("is up to date in corpus.json", () => {
    expect(readFileSync(CORPUS, "utf8")).toBe(written(corpus));
  });

  it("holds every message GAS refuses a query with", () => {
    const messages = corpus.entries
      .map(({ outcome }) => outcome.message)
      .filter(Boolean);
    const missing = Object.entries(ALL_MESSAGES)
      .filter(
        ([, message]) =>
          !messages.some((text) => patternOf(message).test(text)),
      )
      .map(([key]) => key);

    expect(missing).toEqual([]);
  });

  it("makes only Queries that keep the rules a service checks again", () => {
    const broken = corpus.entries
      .filter(({ outcome }) => outcome === "ok")
      .map(({ text }) => readQuery(text, vocabulary))
      .filter(({ query, source }) => !keepsRules(source, query));

    expect(broken).toEqual([]);
  });

  it("makes only Queries the wire format takes, as a service checks them", () => {
    const refused = corpus.entries
      .filter(({ outcome }) => outcome === "ok")
      .map(({ text }) => [text, readQuery(text, vocabulary).query])
      .map(([text, query]) => [
        text,
        { ...query, v: Math.max(...QUERY_VERSIONS) },
      ])
      .filter(
        ([, query]) =>
          querySchema.validate(query).error !== undefined ||
          !isWithinLimits(query),
      )
      .map(([text]) => text);

    expect(refused).toEqual([]);
  });

  it("runs every token form and spec check that should run", () => {
    const failing = corpus.entries
      .filter(({ text }) => TOKEN_FORMS.includes(text))
      .filter(({ outcome }) => outcome !== "ok")
      .map(({ text }) => text);

    expect(failing).toEqual([
      `db.applications.find({ ${N}: { $in: [/a/] } })`,
      "db.applications.distinct(/x/)",
    ]);
  });
});
