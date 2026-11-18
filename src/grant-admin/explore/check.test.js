import { describe, expect, it } from "vitest";
import { exploreVocabulary } from "../../../test/helpers/explore-vocabulary.js";
import { CHECK_MESSAGES, narrowingPaths, windowedMessage } from "./check.js";
import { readQuery } from "./language/query.js";

const vocabulary = exploreVocabulary();
const READ_SO =
  "clientRef, identifiers.sbi, refs, code, currentConfigVersion with code, createdAt";
const NAME = "'phases.answers.applicant.business.name'";

const pointed = (text) => {
  const { error } = readQuery(text, vocabulary);

  return error && [error.message, text.slice(error.at, error.end)];
};

describe("read rules", () => {
  it.each([
    `db.applications.find({ ${NAME}: /hill/i })`,
    "db.applications.find({ code: 'a' }).sort({ createdAt: -1 })",
    "db.applications.find({ code: 'a' }).sort({ createdAt: 1 })",
    "db.applications.aggregate([{ $match: { code: 'a' } }, { $group: { _id: '$currentStatus', n: { $sum: 1 } } }])",
    "db.applications.countDocuments({ 'identifiers.sbi': '1' })",
    "db.applications.countDocuments({ refs: { $in: ['sbi:1', 'agreement:a'] } })",
    "db.applications.distinct('currentStatus', { code: 'a', createdAt: { $gte: '2026-01-01' } })",
    "db.applications.distinct('currentStatus', { code: 'a', createdAt: { $gte: ISODate('2026-01-01') } })",
    "db.applications.distinct('currentStatus', { $or: [{ code: 'a' }, { code: 'b' }] })",
    "db.applications.countDocuments({ $or: [{ 'identifiers.sbi': '1' }, { clientRef: 'r' }, { refs: 'agreement:a' }] })",
    "db.applications.countDocuments({ clientRef: { $in: ['a', 'b', 'c'] } })",
    "db.applications.countDocuments({ 'identifiers.sbi': 200000001 })",
    "db.agreements.find({ state: /x/ }).sort({ totalAmountPence: 1 })",
    "db.agreements.countDocuments({ state: /x/ })",
  ])("reads %s", (text) => {
    expect(pointed(text)).toBeUndefined();
  });

  it.each([
    [
      `db.applications.aggregate([{ $match: { code: 'a', ${NAME}: /hill/ } }, { $group: { _id: '$currentStatus', n: { $sum: 1 } } }])`,
      CHECK_MESSAGES.countWindowed(
        "$group",
        "phases.answers.applicant.business.name is read a record at a time",
        READ_SO,
      ),
      "/hill/",
    ],
    [
      "db.applications.countDocuments({ 'phases.answers.parcels.areaHa': { $gt: 4 } })",
      CHECK_MESSAGES.countWindowed(
        "countDocuments",
        "phases.answers.parcels.areaHa is read a record at a time",
        READ_SO,
      ),
      "4",
    ],
    [
      "db.applications.distinct('currentStatus', { $or: [{ code: 'a' }, { 'identifiers.sbi': 'b' }] })",
      CHECK_MESSAGES.countWindowed(
        "distinct",
        "a condition under $or, $nor or $not is read a record at a time",
        READ_SO,
      ),
      "'a'",
    ],
    [
      "db.applications.countDocuments({ code: { $in: [null, 'a'] } })",
      CHECK_MESSAGES.countWindowed(
        "countDocuments",
        "code with null in $in, which also means no value, is read a record at a time",
        READ_SO,
      ),
      "null",
    ],
    [
      "db.applications.countDocuments({ clientRef: '' })",
      CHECK_MESSAGES.countWindowed(
        "countDocuments",
        "clientRef is read through its index only with a value or $in",
        READ_SO,
      ),
      "''",
    ],
    [
      "db.applications.countDocuments({ createdAt: { $gt: 4 } })",
      CHECK_MESSAGES.countWindowed(
        "countDocuments",
        "createdAt is read through its index only with an ISODate and $gt, $gte, $lt or $lte",
        READ_SO,
      ),
      "4",
    ],
    [
      "db.applications.find({ currentConfigVersion: '1' }).sort({ clientRef: 1 })",
      CHECK_MESSAGES.orderWindowed(
        "currentConfigVersion is read through its index only beside code",
        READ_SO,
      ),
      "clientRef",
    ],
    [
      "db.events.countDocuments({ eventType: { $gt: 'a' } })",
      CHECK_MESSAGES.countWindowed(
        "countDocuments",
        "eventType is read through its index only with a value, $ne, $in or $nin",
        "eventType, status, service, box, refs, publicationDate",
      ),
      "'a'",
    ],
  ])("refuses %s", (text, message, at) => {
    expect(pointed(text)).toEqual([message, at]);
  });

  it("names the method in a refusal the run itself makes", () => {
    const source = vocabulary.sources.get("applications");
    const query = {
      mode: "groups",
      where: {
        path: "phases.answers.applicant.business.name",
        op: "regex",
        values: [],
      },
    };

    expect(
      windowedMessage("GROUP_NEEDS_EXACT", {
        source,
        query,
        detail: { why: "TOO_MANY_COMBINATIONS", path: null },
      }),
    ).toBe(
      CHECK_MESSAGES.countWindowed(
        "$group",
        "the conditions make too many combinations of values",
        READ_SO,
      ),
    );
  });
});

describe("narrowingPaths", () => {
  const applications = vocabulary.sources.get("applications");
  const where = readQuery(
    "db.applications.find({ code: 'a', $or: [{ clientRef: 'r' }, { clientRef: 's' }] })",
    vocabulary,
  ).query.where;

  it("names every indexed path that would narrow the query", () => {
    expect(narrowingPaths(applications, null).join(", ")).toBe(READ_SO);
  });

  it("leaves out a path already tested at the top, never one inside $or", () => {
    const paths = narrowingPaths(applications, where, { untested: true });

    expect(paths).not.toContain("code");
    expect(paths).toContain("clientRef");
  });
});
