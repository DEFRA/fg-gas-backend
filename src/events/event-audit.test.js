import { describe, expect, it, vi } from "vitest";
import { shortEventType } from "../grant-admin/services/map-event-row.js";
import {
  AUDIT_EXCLUDE,
  AUDIT_INCLUDE,
  AUDIT_MODES,
  AUDIT_TARGET_FIELDS,
  AUDIT_TYPE,
  EVENT_TYPE_FIELDS,
  UNKNOWN_TYPE,
  auditClauses,
  auditGroupExpression,
  isAuditTarget,
  labelForMissingType,
} from "./event-audit.js";

// Inlined rather than referencing the constant below: `vi.mock` is hoisted
// above every declaration in this file.
vi.mock("../common/config.js", () => ({
  config: {
    sns: {
      auditTopicArn:
        "arn:aws:sns:eu-west-2:000000000000:gas__sns__audit_topic_arn",
    },
  },
}));

const ARN = "arn:aws:sns:eu-west-2:000000000000:gas__sns__audit_topic_arn";
const OTHER_ARN =
  "arn:aws:sns:eu-west-2:000000000000:gas__sns__create_new_case.fifo";

describe("isAuditTarget", () => {
  it("recognises the topic under a different account id", () => {
    expect(
      isAuditTarget(
        "arn:aws:sns:eu-west-2:332499610595:gas__sns__audit_topic_arn",
      ),
    ).toBe(true);
  });

  it("recognises the topic write-audit-event.js addresses", () => {
    expect(isAuditTarget(ARN)).toBe(true);
  });

  it.each([OTHER_ARN, "internal:message-bus", null, undefined, ""])(
    "does not recognise %p",
    (target) => {
      expect(isAuditTarget(target)).toBe(false);
    },
  );
});

describe("labelForMissingType", () => {
  it("labels an audit-addressed row", () => {
    expect(labelForMissingType(true)).toBe(AUDIT_TYPE);
  });

  it("labels anything else that recorded no type unknown", () => {
    expect(labelForMissingType(false)).toBe(UNKNOWN_TYPE);
  });

  it("reads the fact the caller resolved, whichever shape it came from", () => {
    expect(labelForMissingType(isAuditTarget(ARN))).toBe(AUDIT_TYPE);
    expect(labelForMissingType(isAuditTarget(OTHER_ARN))).toBe(UNKNOWN_TYPE);
  });
});

describe("auditClauses", () => {
  it("adds no clause when audit records are included", () => {
    expect(auditClauses(AUDIT_INCLUDE, "target")).toEqual([]);
  });

  it("removes only the rows addressed at the audit topic", () => {
    const [clause] = auditClauses(AUDIT_EXCLUDE, "target");

    expect(clause.target.$not).toBeInstanceOf(RegExp);
    expect(ARN).toMatch(clause.target.$not);
    expect(
      "arn:aws:sns:eu-west-2:999:gas__sns__update_case_status_fifo",
    ).not.toMatch(clause.target.$not);
  });

  it("matches the topic under any account id", () => {
    const [clause] = auditClauses(AUDIT_EXCLUDE, "target");

    expect(
      "arn:aws:sns:eu-west-2:332499610595:gas__sns__audit_topic_arn",
    ).toMatch(clause.target.$not);
  });

  it("adds no clause for the inbox, which has no target to filter on", () => {
    expect(auditClauses(AUDIT_EXCLUDE, AUDIT_TARGET_FIELDS.inbox)).toEqual([]);
  });

  it("uses the outbox's target field", () => {
    const [clause] = auditClauses(AUDIT_EXCLUDE, AUDIT_TARGET_FIELDS.outbox);

    expect(Object.keys(clause)).toEqual(["target"]);
  });

  it("adds no clause for a mode it does not recognise", () => {
    expect(auditClauses(undefined, "target")).toEqual([]);
  });

  it("offers exactly the two modes the query schemas validate", () => {
    expect(AUDIT_MODES).toEqual(["include", "exclude"]);
  });
});

describe("auditGroupExpression", () => {
  it("asks the breakdown's $group whether a row was audit-addressed", () => {
    expect(auditGroupExpression(AUDIT_TARGET_FIELDS.outbox)).toEqual({
      $eq: [
        { $arrayElemAt: [{ $split: ["$target", ":"] }, -1] },
        "gas__sns__audit_topic_arn",
      ],
    });
  });

  it("is a literal false for the inbox, which has no target", () => {
    expect(auditGroupExpression(AUDIT_TARGET_FIELDS.inbox)).toEqual({
      $literal: false,
    });
  });
});

describe("EVENT_TYPE_FIELDS", () => {
  it("points at where each box stores its CloudEvent type", () => {
    expect(EVENT_TYPE_FIELDS).toEqual({ inbox: "type", outbox: "event.type" });
  });
});

// Checks the JavaScript predicate and the Mongo clause answer identically for
// every shape a row takes, and that they narrow TOGETHER, so an "unknown" row
// is neither labelled audit nor filtered away.
describe("the audit label and the audit filter agree", () => {
  // What `{ target: { $ne: ARN } }` does to a document: it keeps everything
  // whose target is not the audit topic, missing targets included.
  const removedByTheFilter = (target) => target === ARN;

  const labelledAudit = (storedType, target) =>
    shortEventType(storedType, isAuditTarget(target)) === AUDIT_TYPE;

  it.each([
    ["an audit row", null, ARN],
    ["a type-less row on another topic", null, OTHER_ARN],
    ["a type-less row with no target at all", null, null],
    ["a row storing an empty type on the audit topic", "", ARN],
    ["a row storing an empty type elsewhere", "", OTHER_ARN],
  ])("agree on %s", (_name, storedType, target) => {
    expect(labelledAudit(storedType, target)).toBe(removedByTheFilter(target));
  });

  // `write-audit-event.js` never writes a type, so this shape does not occur
  // in practice - but one on the audit topic would be excluded by the filter
  // while still showing its own type, the honest answer for both.
  it("shows a stored type rather than a label, even on the audit topic", () => {
    expect(shortEventType("cloud.defra.prd.svc.case.create", true)).toBe(
      "case.create",
    );
    expect(removedByTheFilter(ARN)).toBe(true);
  });

  it("keeps an unknown row visible while naming it", () => {
    expect(shortEventType(null, isAuditTarget(OTHER_ARN))).toBe(UNKNOWN_TYPE);
    expect(removedByTheFilter(OTHER_ARN)).toBe(false);
  });
});
