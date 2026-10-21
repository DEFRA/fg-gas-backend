import { describe, expect, it, vi } from "vitest";
import {
  AUDIT_TYPE,
  UNKNOWN_TYPE,
  isAuditTarget,
  labelForMissingType,
  shortEventType,
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

describe("shortEventType", () => {
  it("labels a type-less row on the audit topic audit", () => {
    expect(shortEventType(null, isAuditTarget(ARN))).toBe(AUDIT_TYPE);
  });

  it.each([
    ["a type-less row on another topic", null, OTHER_ARN],
    ["a type-less row with no target at all", null, null],
    ["a row storing an empty type elsewhere", "", OTHER_ARN],
  ])("labels %s unknown", (_name, storedType, target) => {
    expect(shortEventType(storedType, isAuditTarget(target))).toBe(
      UNKNOWN_TYPE,
    );
  });

  it("shows a stored type rather than a label, even on the audit topic", () => {
    expect(shortEventType("cloud.defra.prd.svc.case.create", true)).toBe(
      "case.create",
    );
  });
});
