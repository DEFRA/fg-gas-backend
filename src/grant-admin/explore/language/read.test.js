import { describe, expect, it } from "vitest";
import { exploreVocabulary } from "../../../../test/helpers/explore-vocabulary.js";
import { readQuery } from "./query.js";
import { READ_MESSAGES } from "./read.js";

const vocabulary = exploreVocabulary();
const readOf = (text) => readQuery(text, vocabulary);
const queryOf = (text) => {
  const result = readOf(text);

  expect(result.error).toBeUndefined();

  return result.query;
};
const whereOf = (filter) => queryOf(`db.applications.find(${filter})`).where;
const errorOf = (text) => readOf(text).error;
const test = (path, op, values = []) => ({ path, op, values });

const NAME = "phases.answers.applicant.business.name";
const AREA = "phases.answers.parcels.areaHa";
const applications = vocabulary.sources.get("applications");
const cases = vocabulary.sources.get("cases");

// The error and the text it points at.
const pointed = (text) => {
  const error = errorOf(text);

  return error && [error.message, text.slice(error.at, error.end)];
};

describe("read", () => {
  describe("find", () => {
    it("reads find() as rows with the source's default columns", () => {
      expect(queryOf("db.applications.find()")).toEqual({
        v: 2,
        source: "applications",
        mode: "rows",
        columns: [
          { path: "clientRef" },
          { path: "code" },
          { path: "currentStatus" },
          { path: "createdAt" },
        ],
        where: null,
        unwind: [],
        groupBy: null,
        orderBy: null,
        limit: 50,
        positions: null,
      });
    });

    it("reads a projection to columns: paths, renamed paths and worked out ones", () => {
      expect(
        queryOf(
          `db.applications.find({}, { _id: 0, clientRef: 1, 'identifiers.sbi': true, name: '$${NAME}', parcels: { $size: '$phases.answers.parcels.parcelId' }, total: { $sum: '$${AREA}' }, first: { $min: '$createdAt' }, last: { $max: '$${NAME}' } })`,
        ).columns,
      ).toEqual([
        { path: "clientRef" },
        { path: "identifiers.sbi" },
        { path: NAME, as: "name" },
        { fn: "count", path: "phases.answers.parcels.parcelId", as: "parcels" },
        { fn: "sum", path: AREA, as: "total" },
        { fn: "min", path: "createdAt", as: "first" },
        { fn: "max", path: NAME, as: "last" },
      ]);
    });

    it("reads a path the vocabulary doesn't suggest, under a root", () => {
      expect(
        queryOf("db.applications.find({}, { 'phases.0.answers.x-y': 1 })")
          .columns,
      ).toEqual([{ path: "phases.0.answers.x-y" }]);
    });

    it("keeps any name as a column's as, never as a key", () => {
      expect(
        queryOf("db.applications.find({}, { __proto__: '$clientRef' })")
          .columns,
      ).toEqual([{ path: "clientRef", as: "__proto__" }]);
    });

    it("reads .sort and .limit, by a path or a column's name", () => {
      expect(
        queryOf(
          "db.agreements.find({}, { n: { $sum: '$totalAmountPence' } }).sort({ n: 1 }).limit(10)",
        ),
      ).toMatchObject({
        orderBy: { path: "totalAmountPence", fn: "sum", desc: false },
        limit: 10,
      });
      expect(
        queryOf("db.applications.find().sort({ createdAt: 1 })").orderBy,
      ).toEqual({ path: "createdAt", fn: null, desc: false });
      expect(
        queryOf("db.applications.find().sort({ currentStatus: -1 })").orderBy,
      ).toEqual({ path: "currentStatus", fn: null, desc: true });
    });

    it("writes newest first, the read's own order, as no sort", () => {
      expect(
        queryOf("db.applications.find().sort({ createdAt: -1 })").orderBy,
      ).toBeNull();
    });

    it("caps a limit over 5,000", () => {
      expect(
        readOf("db.agreements.find({}, { state: 1 }).limit(9000)"),
      ).toMatchObject({ query: { limit: 5000 } });
    });

    it("takes no projection, or an empty one, as the defaults", () => {
      expect(queryOf("db.agreements.find({}, {})").columns).toHaveLength(3);
      expect(
        queryOf("db.agreements.find({}, { _id: 0 })").columns,
      ).toHaveLength(3);
    });
  });

  describe("filters", () => {
    it.each([
      ["{ code: 'woodland' }", test("code", "eq", ["woodland"])],
      ["{ code: { $eq: 'woodland' } }", test("code", "eq", ["woodland"])],
      ["{ code: { $ne: 'woodland' } }", test("code", "ne", ["woodland"])],
      [`{ '${AREA}': { $gt: 4 } }`, test(AREA, "gt", [4])],
      [`{ '${AREA}': { $gte: '4.5' } }`, test(AREA, "gte", ["4.5"])],
      [`{ '${AREA}': { $lt: 4 } }`, test(AREA, "lt", [4])],
      [`{ '${AREA}': { $lte: 4 } }`, test(AREA, "lte", [4])],
      ["{ code: { $in: ['a', 'b'] } }", test("code", "in", ["a", "b"])],
      ["{ code: { $nin: ['a'] } }", test("code", "nin", ["a"])],
      ["{ code: null }", test("code", "eq", [null])],
      ["{ code: { $eq: null } }", test("code", "eq", [null])],
      ["{ code: { $ne: null } }", test("code", "ne", [null])],
      ["{ code: { $exists: false } }", test("code", "empty")],
      ["{ code: { $exists: true } }", test("code", "filled")],
      ["{ code: { $exists: 1 } }", test("code", "filled")],
      ["{ code: { $exists: 0 } }", test("code", "empty")],
      [
        "{ 'phases.answers.agentDeclaration': true }",
        test("phases.answers.agentDeclaration", "eq", [true]),
      ],
      [
        "{ 'phases.answers.agentDeclaration': { $in: [false, null] } }",
        test("phases.answers.agentDeclaration", "in", [false, null]),
      ],
      [
        "{ createdAt: { $gte: ISODate('2026-10-01') } }",
        test("createdAt", "gte", [{ date: "2026-10-01" }]),
      ],
      [
        "{ createdAt: Date('2026-10-01T09:00:00Z') }",
        test("createdAt", "eq", [{ date: "2026-10-01T09:00:00Z" }]),
      ],
      [
        "{ createdAt: { $lt: '2026-10-01' } }",
        test("createdAt", "lt", ["2026-10-01"]),
      ],
      [
        `{ '${NAME}': /hill/i }`,
        test(NAME, "regex", [{ pattern: "hill", flags: "i" }]),
      ],
      [
        `{ '${NAME}': { $regex: 'hi.l' } }`,
        test(NAME, "regex", [{ pattern: "hi.l", flags: "" }]),
      ],
      [
        `{ '${NAME}': { $regex: 'hill', $options: 'im' } }`,
        test(NAME, "regex", [{ pattern: "hill", flags: "im" }]),
      ],
      [
        `{ '${NAME}': { $regex: /hill/s } }`,
        test(NAME, "regex", [{ pattern: "hill", flags: "s" }]),
      ],
      [
        `{ '${NAME}': { $not: /hill/ } }`,
        { not: test(NAME, "regex", [{ pattern: "hill", flags: "" }]) },
      ],
      [`{ '${AREA}': { $not: { $gt: 4 } } }`, { not: test(AREA, "gt", [4]) }],
      [
        `{ '${AREA}': { $gt: 1, $lt: 9 } }`,
        { all: [test(AREA, "gt", [1]), test(AREA, "lt", [9])] },
      ],
      [
        "{ code: 'a', 'identifiers.sbi': '1' }",
        {
          all: [
            test("code", "eq", ["a"]),
            test("identifiers.sbi", "eq", ["1"]),
          ],
        },
      ],
      [
        "{ $and: [{ code: 'a' }, { refs: 'sbi:1' }] }",
        { all: [test("code", "eq", ["a"]), test("refs", "eq", ["sbi:1"])] },
      ],
      [
        "{ $or: [{ code: 'a' }, { 'identifiers.sbi': '1' }] }",
        {
          any: [
            test("code", "eq", ["a"]),
            test("identifiers.sbi", "eq", ["1"]),
          ],
        },
      ],
      [
        "{ $nor: [{ code: 'a' }] }",
        { not: { any: [test("code", "eq", ["a"])] } },
      ],
      ["{ code: { $in: ['a', null] } }", test("code", "in", ["a", null])],
      ["{ code: { $nin: [null, 'a'] } }", test("code", "nin", [null, "a"])],
      ["{ 'phases.0.code': 'x' }", test("phases.0.code", "eq", ["x"])],
      ["{}", null],
    ])("reads %s", (filter, where) => {
      expect(whereOf(filter)).toEqual(where);
    });

    it("reads a bare key and a quoted one alike", () => {
      expect(whereOf("{ 'code': 'a' }")).toEqual(test("code", "eq", ["a"]));
    });

    it("reads an answer of a case on Caseworking's list", () => {
      expect(
        queryOf(
          "db.cases.find({ 'payload.answers.applicant.business.name': /x/ })",
        ).where.path,
      ).toBe("payload.answers.applicant.business.name");
    });
  });

  describe("aggregate", () => {
    it("reads $unwind in both forms, each in turn, then $group", () => {
      expect(
        queryOf(
          "db.applications.aggregate([{ $match: { code: 'woodland' } }, { $unwind: '$phases' }, { $unwind: { path: '$phases.answers.parcels', preserveNullAndEmptyArrays: true } }, { $group: { _id: '$phases.answers.parcels.parcelId', n: { $sum: 1 } } }])",
        ),
      ).toMatchObject({
        mode: "groups",
        unwind: [
          { path: "phases", preserve: false },
          { path: "phases.answers.parcels", preserve: true },
        ],
        groupBy: { path: "phases.answers.parcels.parcelId" },
      });
    });

    it("reads $unwind then $project, $sort and $limit as rows", () => {
      expect(
        queryOf(
          "db.applications.aggregate([{ $unwind: { path: '$phases', preserveNullAndEmptyArrays: false } }, { $project: { clientRef: 1, phase: '$phases.code' } }, { $sort: { phase: 1 } }, { $limit: 10 }])",
        ),
      ).toMatchObject({
        mode: "rows",
        unwind: [{ path: "phases", preserve: false }],
        columns: [{ path: "clientRef" }, { path: "phases.code", as: "phase" }],
        orderBy: { path: "phases.code", fn: null, desc: false },
        limit: 10,
      });
    });

    it.each([
      [
        "db.applications.aggregate([{ $unwind: 'phases' }])",
        READ_MESSAGES.ref("$unwind"),
        "'phases'",
      ],
      [
        "db.applications.aggregate([{ $unwind: { preserveNullAndEmptyArrays: true } }])",
        READ_MESSAGES.unwind,
        "{ preserveNullAndEmptyArrays: true }",
      ],
      [
        "db.applications.aggregate([{ $unwind: { path: '$phases', includeArrayIndex: 'n' } }])",
        READ_MESSAGES.unwindKey("includeArrayIndex"),
        "includeArrayIndex",
      ],
      [
        "db.applications.aggregate([{ $unwind: { path: '$phases', preserveNullAndEmptyArrays: 'yes' } }])",
        READ_MESSAGES.preserve,
        "'yes'",
      ],
      [
        "db.applications.aggregate([{ $group: { _id: '$code' } }, { $unwind: '$phases' }])",
        READ_MESSAGES.order,
        "$unwind",
      ],
      [
        "db.applications.aggregate([{ $unwind: '$phases' }, { $match: {} }])",
        READ_MESSAGES.order,
        "$match",
      ],
      [
        "db.applications.aggregate([{ $unwind: '$phases' }, { $unwind: '$phases' }, { $unwind: '$phases' }, { $unwind: '$phases' }, { $unwind: '$phases' }, { $limit: 1 }])",
        READ_MESSAGES.stages,
        "{ $limit: 1 }",
      ],
      [
        "db.applications.aggregate([{ $unwind: '$phases' }, { $unwind: '$phases' }, { $unwind: '$phases' }, { $unwind: '$phases' }, { $unwind: '$events' }])",
        READ_MESSAGES.unwinds,
        "$unwind",
      ],
      [
        "db.applications.aggregate([{ $unwind: '$identifiers.nino' }])",
        undefined,
        "'$identifiers.nino'",
      ],
      [
        "db.cases.aggregate([{ $unwind: '$comments' }])",
        undefined,
        "'$comments'",
      ],
      [
        "db.applications.aggregate([{ $group: { _id: '$code', $match: { $sum: 1 } } }])",
        READ_MESSAGES.dollarName("$match"),
        "$match",
      ],
    ])("refuses %s", (text, message, at) => {
      const [said, pointedAt] = pointed(text);

      if (message) {
        expect(said).toBe(message);
      }

      expect(pointedAt).toBe(at);
    });

    it("reads $match and $group as groups", () => {
      expect(
        queryOf(
          "db.events.aggregate([{ $match: { status: 'DEAD_LETTER' } }, { $group: { _id: '$eventType', events: { $sum: 1 }, n: { $count: {} }, latest: { $max: '$publicationDate' } } }, { $sort: { events: -1 } }, { $limit: 20 }])",
        ),
      ).toMatchObject({
        mode: "groups",
        where: test("status", "eq", ["DEAD_LETTER"]),
        groupBy: { path: "eventType" },
        columns: [
          { path: "eventType" },
          { fn: "count", path: "*", as: "events" },
          { fn: "count", path: "*", as: "n" },
          { fn: "max", path: "publicationDate", as: "latest" },
        ],
        orderBy: { path: "*", fn: "count", desc: true },
        limit: 20,
      });
    });

    it("sorts groups by _id or the group's path, newest first too", () => {
      expect(
        queryOf(
          "db.agreements.aggregate([{ $group: { _id: '$state', total: { $sum: '$totalAmountPence' } } }, { $sort: { _id: 1 } }])",
        ).orderBy,
      ).toEqual({ path: "state", fn: null, desc: false });
      expect(
        queryOf(
          "db.events.aggregate([{ $group: { _id: '$publicationDate' } }, { $sort: { _id: -1 } }])",
        ).orderBy,
      ).toEqual({ path: "publicationDate", fn: null, desc: true });
    });

    it("reads $project as find's projection", () => {
      expect(
        queryOf(
          "db.agreements.aggregate([{ $match: { state: 'x' } }, { $project: { agreementNumber: 1 } }, { $limit: 3 }])",
        ),
      ).toMatchObject({
        mode: "rows",
        columns: [{ path: "agreementNumber" }],
        limit: 3,
      });
    });

    it("reads a pipeline without $project or $group as the default rows", () => {
      expect(
        queryOf("db.agreements.aggregate([{ $match: {} }])").columns,
      ).toHaveLength(3);
    });

    it("sums and takes the extremes of any path, whatever it holds", () => {
      expect(
        queryOf(
          "db.agreements.aggregate([{ $group: { _id: '$state', a: { $sum: '$agreementNumber' }, b: { $min: '$state' } } }])",
        ).columns,
      ).toEqual([
        { path: "state" },
        { fn: "sum", path: "agreementNumber", as: "a" },
        { fn: "min", path: "state", as: "b" },
      ]);
    });
  });

  describe("countDocuments and distinct", () => {
    it("reads countDocuments as a count", () => {
      expect(queryOf("db.payments.countDocuments({ sbi: '1' })")).toMatchObject(
        {
          mode: "count",
          columns: [{ fn: "count", path: "*" }],
          where: test("sbi", "eq", ["1"]),
          groupBy: null,
        },
      );
      expect(queryOf("db.payments.countDocuments()").where).toBeNull();
    });

    it("reads distinct as one column grouped by its path", () => {
      expect(
        queryOf("db.agreements.distinct('state', { totalAmountPence: 3 })"),
      ).toMatchObject({
        mode: "distinct",
        columns: [{ path: "state" }],
        groupBy: { path: "state" },
        where: test("totalAmountPence", "eq", [3]),
        limit: 5000,
      });
    });
  });

  it("throws the failure of a source whose service didn't answer", () => {
    expect(() => readOf("db.workflows.find()")).toThrow(
      "not in this vocabulary",
    );
  });

  it.each([
    [
      "db.applications.find({}, { clientRef: 1, colour: 1 })",
      READ_MESSAGES.NOT_A_ROOT("colour", applications),
      "colour",
    ],
    [
      "db.applications.find({ anything: /9238/ })",
      READ_MESSAGES.NOT_A_ROOT("anything", applications),
      "anything",
    ],
    [
      "db.cases.find({ 'comments.text': /x/ })",
      READ_MESSAGES.NOT_A_ROOT("comments.text", cases),
      "'comments.text'",
    ],
    [
      "db.cases.find({}, { a: '$payload.answers.other' })",
      READ_MESSAGES.NOT_LISTED("payload.answers.other"),
      "'$payload.answers.other'",
    ],
    [
      "db.applications.find({ 'identifiers.nino': 'x' })",
      READ_MESSAGES.DENIED("identifiers.nino"),
      "'identifiers.nino'",
    ],
    [
      "db.applications.find({}, { _id: 1 })",
      READ_MESSAGES.DENIED("_id"),
      "_id",
    ],
    [
      "db.applications.find({ 'phases..x': 1 })",
      READ_MESSAGES.MALFORMED("phases..x"),
      "'phases..x'",
    ],
    [
      "db.applications.find({ 'phases.__proto__': 1 })",
      READ_MESSAGES.MALFORMED("phases.__proto__"),
      "'phases.__proto__'",
    ],
    [
      "db.applications.find({ 'phases.$': 1 })",
      READ_MESSAGES.MALFORMED("phases.$"),
      "'phases.$'",
    ],
    [
      "db.applications.find({}, { n: '$nope' })",
      READ_MESSAGES.NOT_A_ROOT("nope", applications),
      "'$nope'",
    ],
    [
      "db.applications.find({}, { n: { $size: 'phases' } })",
      READ_MESSAGES.ref("$size"),
      "'phases'",
    ],
    [
      "db.applications.find({}, { clientRef: 0 })",
      READ_MESSAGES.zero,
      "clientRef",
    ],
    [
      "db.applications.find({}, { clientRef: 2 })",
      READ_MESSAGES.show,
      "clientRef",
    ],
    [
      `db.applications.find({}, { n: { $gt: '$${AREA}' } })`,
      READ_MESSAGES.show,
      "n",
    ],
    ["db.applications.find({}, [1])", READ_MESSAGES.fields, "[1]"],
    ["db.applications.find([])", READ_MESSAGES.filter, "[]"],
    ["db.applications.find({ $gt: 4 })", READ_MESSAGES.notHere("$gt"), "$gt"],
    [
      "db.applications.find({ '$where': 4 })",
      "$where isn’t one of the operators you can use",
      "'$where'",
    ],
    [
      "db.applications.find({ code: { $and: [] } })",
      READ_MESSAGES.notAnOp("$and"),
      "$and",
    ],
    [
      "db.applications.find({ code: { big: 1 } })",
      READ_MESSAGES.notAnOp("big"),
      "big",
    ],
    [
      "db.applications.find({ code: { $in: 'a' } })",
      READ_MESSAGES.inList("$in"),
      "$in",
    ],
    [
      "db.applications.find({ code: { $nin: [] } })",
      READ_MESSAGES.inList("$nin"),
      "$nin",
    ],
    [
      "db.applications.find({ code: ['a'] })",
      READ_MESSAGES.list("code"),
      "['a']",
    ],
    [
      "db.applications.find({ code: { $exists: 2 } })",
      READ_MESSAGES.exists,
      "2",
    ],
    ["db.applications.find({ code: { $regex: 4 } })", READ_MESSAGES.regex, "4"],
    [
      "db.applications.find({ code: { $options: 'i' } })",
      READ_MESSAGES.options,
      "$options",
    ],
    [
      "db.applications.find({ code: { $regex: /a/i, $options: 'i' } })",
      READ_MESSAGES.flagsTwice,
      "$options",
    ],
    [
      "db.applications.find({ code: { $regex: 'a', $options: 1 } })",
      READ_MESSAGES.optionsText,
      "1",
    ],
    ["db.applications.find({ code: { $not: 4 } })", READ_MESSAGES.not, "4"],
    [
      "db.applications.find({ code: /(?=a)/ })",
      "This pattern uses a look-ahead, which isn’t supported",
      "/(?=a)/",
    ],
    [
      "db.applications.find({ code: /a/g })",
      "Patterns take the flags i, m, s and u, each once",
      "/a/g",
    ],
    [
      `db.applications.find({ code: { $regex: '${"a".repeat(65)}' } })`,
      "Keep the pattern to at most 64 characters",
      `'${"a".repeat(65)}'`,
    ],
    [
      `db.applications.find({ '${AREA}': { $gt: null } })`,
      READ_MESSAGES.compared,
      "null",
    ],
    [
      "db.applications.find({ createdAt: ISODate('2026-02-30') })",
      READ_MESSAGES.date,
      "'2026-02-30'",
    ],
    [
      "db.cases.find({ createdAt: { $gte: '2026-10-01' } })",
      READ_MESSAGES.dateStored("createdAt"),
      "'2026-10-01'",
    ],
    [
      "db.events.find({ publicationDate: { $in: ['2026-10-01'] } })",
      READ_MESSAGES.dateStored("publicationDate"),
      "'2026-10-01'",
    ],
    [
      "db.events.find({ service: 'Caseworking' })",
      READ_MESSAGES.service,
      "'Caseworking'",
    ],
    ["db.events.find({ box: 'sideways' })", READ_MESSAGES.box, "'sideways'"],
    [
      `db.applications.find({ '${NAME}': '${"x".repeat(201)}' })`,
      READ_MESSAGES.valueLength,
      `'${"x".repeat(201)}'`,
    ],
    [
      `db.applications.find({ code: { $in: [${"'a',".repeat(51)}] } })`,
      READ_MESSAGES.values,
      "'a'",
    ],
    ["db.applications.find({ $or: {} })", READ_MESSAGES.logic("$or"), "$or"],
    ["db.applications.find({ $or: [{}] })", READ_MESSAGES.emptyFilter, "{}"],
    [
      "db.applications.find().sort({ createdAt: -1, clientRef: 1 })",
      READ_MESSAGES.sortOne,
      "{ createdAt: -1, clientRef: 1 }",
    ],
    [
      "db.applications.find().sort({ createdAt: 'desc' })",
      READ_MESSAGES.sortWay,
      "'desc'",
    ],
    [
      "db.applications.find().sort({ colour: 1 })",
      READ_MESSAGES.NOT_A_ROOT("colour", applications),
      "colour",
    ],
    ["db.applications.find().limit(0)", READ_MESSAGES.limit, "0"],
    ["db.applications.find().limit(2.5)", READ_MESSAGES.limit, "2.5"],
    ["db.applications.find({}, {}, {})", READ_MESSAGES.find, "{}"],
    [
      "db.payments.countDocuments().limit(3)",
      READ_MESSAGES.ends("countDocuments"),
      "limit",
    ],
    ["db.payments.countDocuments({}, {})", READ_MESSAGES.countDocuments, "{}"],
    ["db.payments.distinct()", READ_MESSAGES.distinct, "distinct"],
    [
      "db.payments.distinct(sbi)",
      "A value goes here: 'text', a number, /pattern/i, true, or { … }",
      "sbi",
    ],
    ["db.payments.distinct(1)", READ_MESSAGES.distinct, "1"],
    [
      "db.payments.distinct('bank.iban')",
      READ_MESSAGES.DENIED("bank.iban"),
      "'bank.iban'",
    ],
    ["db.agreements.aggregate([])", READ_MESSAGES.aggregate, "[]"],
    ["db.agreements.aggregate({})", READ_MESSAGES.aggregate, "{}"],
    [
      "db.agreements.aggregate([{ $match: {} }]).limit(3)",
      READ_MESSAGES.afterFind("limit"),
      "limit",
    ],
    [
      "db.agreements.aggregate([{ $match: {}, $limit: 1 }])",
      READ_MESSAGES.stage,
      "{ $match: {}, $limit: 1 }",
    ],
    [
      "db.agreements.aggregate([{ $in: [] }])",
      READ_MESSAGES.stageNotAllowed("$in"),
      "$in",
    ],
    [
      "db.agreements.aggregate([{ '$lookup': {} }])",
      "$lookup isn’t one of the operators you can use",
      "'$lookup'",
    ],
    [
      "db.agreements.aggregate([{ $limit: 1 }, { $match: {} }])",
      READ_MESSAGES.order,
      "$match",
    ],
    [
      "db.agreements.aggregate([{ $group: { _id: '$state' } }, { $project: { state: 1 } }])",
      READ_MESSAGES.order,
      "$project",
    ],
    [
      "db.agreements.aggregate([{ $group: { n: { $sum: 1 } } }])",
      READ_MESSAGES.groupId,
      "$group",
    ],
    [
      "db.agreements.aggregate([{ $group: { _id: 'state' } }])",
      READ_MESSAGES.ref("_id"),
      "'state'",
    ],
    ["db.agreements.aggregate([{ $group: 1 }])", READ_MESSAGES.group, "1"],
    [
      "db.agreements.aggregate([{ $group: { _id: '$state', n: { $gt: '$totalAmountPence' } } }])",
      READ_MESSAGES.work("n"),
      "n",
    ],
    [
      "db.agreements.aggregate([{ $group: { _id: '$state', n: { $sum: 2 } } }])",
      READ_MESSAGES.sumOne,
      "2",
    ],
    [
      "db.agreements.aggregate([{ $group: { _id: '$state', n: { $count: 1 } } }])",
      READ_MESSAGES.count,
      "1",
    ],
    [
      "db.agreements.aggregate([{ $group: { _id: '$state' } }, { $sort: { agreementNumber: 1 } }])",
      READ_MESSAGES.sortGroups,
      "agreementNumber",
    ],
    [
      "db.agreements.aggregate([{ $limit: 'x' }])",
      READ_MESSAGES.stageLimit,
      "'x'",
    ],
    [
      `db.agreements.find({}, { ${"x".repeat(65)}: '$state' })`,
      READ_MESSAGES.name,
      "x".repeat(65),
    ],
    ["db.agreements.find({}, { '': '$state' })", READ_MESSAGES.emptyName, "''"],
    [
      "db.agreements.aggregate([{ $group: { _id: '$state', '': { $sum: 1 } } }])",
      READ_MESSAGES.emptyName,
      "''",
    ],
    [
      `db.agreements.find({}, { ${Array.from({ length: 21 }, (_, n) => `c${n}: '$state'`).join(", ")} })`,
      READ_MESSAGES.columns,
      "c20",
    ],
    [
      "db.agreements.find({}, { agreementNumber: 1, state: 1, totalAmountPence: 1, a: '$state', b: '$state' }).limit(5000)",
      READ_MESSAGES.cells(5, 5000),
      "5000",
    ],
  ])("refuses %s", (text, message, at) => {
    expect(pointed(text)).toEqual([message, at]);
  });

  it("refuses more than 30 conditions", () => {
    const tests = Array.from({ length: 31 }, (_, n) => `{ code: '${n}' }`);

    expect(
      pointed(`db.applications.find({ $or: [${tests.join(", ")}] })`),
    ).toEqual([READ_MESSAGES.tests, "'30'"]);
  });
});
