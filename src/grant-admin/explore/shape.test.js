import { describe, expect, it } from "vitest";
import { knownWordsOf } from "../../common/explore/audit.js";
import { lex } from "./language/lex.js";
import { parse } from "./language/parse.js";
import { shapeOf } from "./shape.js";

const known = knownWordsOf([
  "clientRef",
  "createdAt",
  "eventType",
  "lastError.message",
  "identifiers.sbi",
  "sbi",
  "currentStage",
  "workflowCode",
  "caseRef",
  "agreements",
  "phases.answers.applicant.business.name",
  "phases.answers.parcels.areaHa",
  "phases.answers.agentDeclaration",
]);

const shape = (text) => shapeOf(parse(text, lex(text)).tree, known);

describe("shapeOf", () => {
  it.each([
    [
      "db.applications.find({ 'phases.answers.applicant.business.name': /Sentinel Farm/i, 'phases.answers.parcels.areaHa': { $gt: 4.5 }, 'identifiers.sbi': { $in: ['123', null] }, createdAt: { $gte: ISODate('2026-10-01') }, 'phases.answers.agentDeclaration': true }, { clientRef: 1, name: '$phases.answers.applicant.business.name' }).sort({ createdAt: -1 }).limit(10)",
      "db.applications.find({ 'phases.answers.applicant.business.name': /?/, 'phases.answers.parcels.areaHa': { $gt: ? }, 'identifiers.sbi': { $in: [?, null] }, createdAt: { $gte: ISODate(?) }, 'phases.answers.agentDeclaration': true }, { clientRef: 1, name: '$phases.answers.applicant.business.name' }).sort({ createdAt: -1 }).limit(10)",
    ],
    [
      "db.events.aggregate([{ $match: { 'lastError.message': 'Sentinel' } }, { $group: { _id: '$eventType', n: { $sum: 1 } } }, { $sort: { n: -1 } }])",
      "db.events.aggregate([{ $match: { 'lastError.message': ? } }, { $group: { _id: '$eventType', '?': { $sum: 1 } } }, { $sort: { '?': -1 } }])",
    ],
    [
      "db.payments.countDocuments({ sbi: '200000455' }) // Sentinel",
      "db.payments.countDocuments({ sbi: ? })",
    ],
    [
      "db.cases.distinct('currentStage', { 'workflowCode': 'Sentinel' })",
      "db.cases.distinct('currentStage', { workflowCode: ? })",
    ],
    [
      "db.cases.find({ $or: [{ 'odd key': 'x' }] }, { 'two words': '$caseRef' })",
      "db.cases.find({ $or: [{ '?': ? }] }, { '?': '$caseRef' })",
    ],
  ])("writes %s back with every value as ?", (text, written) => {
    expect(shape(text)).toBe(written);
    expect(shape(text)).not.toContain("Sentinel");
  });

  it.each([
    [
      "db.applications.find({ 'agreements.FPTT123.latestStatus': 'x', 'phases.answers.SentinelSmith': 1 })",
      "db.applications.find({ 'agreements.?.?': ?, 'phases.answers.?': ? })",
    ],
    [
      "db.applications.find({}, { 'phases.0.code': 1, total: '$clientRef', n: { $size: '$phases.answers.Sentinel' } })",
      "db.applications.find({}, { 'phases.?.?': 1, '?': '$clientRef', '?': { $size: '$phases.answers.?' } })",
    ],
    [
      "db.applications.find({ 'agreements.200000001': 1 }, { SentinelFarmLtd: '$clientRef', clientRef: 1 })",
      "db.applications.find({ 'agreements.?': ? }, { '?': '$clientRef', clientRef: 1 })",
    ],
    [
      "db.applications.aggregate([{ $unwind: { path: '$phases', preserveNullAndEmptyArrays: true } }, { $group: { _id: '$clientRef', Sentinel: { $sum: 1 } } }])",
      "db.applications.aggregate([{ $unwind: { path: '$phases', preserveNullAndEmptyArrays: true } }, { $group: { _id: '$clientRef', '?': { $sum: 1 } } }])",
    ],
    [
      "db.applications.distinct('phases.answers.Sentinel')",
      "db.applications.distinct('phases.answers.?')",
    ],
  ])(
    "shows a path's words the source doesn't know as ?: %s",
    (text, written) => {
      expect(shape(text)).toBe(written);
      expect(shape(text)).not.toContain("Sentinel");
      expect(shape(text)).not.toContain("FPTT");
    },
  );
});
