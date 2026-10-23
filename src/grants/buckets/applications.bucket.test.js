import { describe, expect, it } from "vitest";
import { STORED, indexKeysOf } from "../../common/buckets/bucket.js";
import { choosePlan } from "../../common/buckets/plan.js";
import { applicationsBucket } from "./applications.bucket.js";

describe("gas.applications", () => {
  const bucket = applicationsBucket();

  it("lists applications by the time they were created, and audits being read", () => {
    expect(bucket).toMatchObject({
      id: "gas.applications",
      path: "applications",
      label: "Applications",
      service: "GAS",
      shortLabel: "Applications",
      icon: "file-text",
      order: 70,
      noun: { one: "application", many: "applications" },
      collection: "applications",
      time: { field: "createdAt", type: "isoString", label: "Created" },
      audited: true,
      timeline: false,
    });
  });

  it("reads its grants from the stored rows, and filters by a version within a grant", () => {
    expect(bucket.facts).toEqual({
      code: {
        label: "Grant",
        values: STORED,
        toggle: null,
        within: null,
        param: "grant",
      },
      currentConfigVersion: {
        label: "Version",
        values: null,
        toggle: null,
        within: "code",
        param: "version",
      },
    });
  });

  it("declares its ref kinds", () => {
    expect(bucket.refs).toEqual({
      ref: "Reference",
      sbi: "SBI",
      frn: "FRN",
      crn: "CRN",
      agreement: "Agreement number",
    });
  });

  it("declares the index keys of its lines", () => {
    expect(indexKeysOf(bucket).map(Object.keys)).toEqual([
      ["createdAt", "_id"],
      ["code", "createdAt", "_id"],
      ["code", "currentConfigVersion", "createdAt", "_id"],
      ["refs", "createdAt", "_id"],
    ]);
  });

  it("reads a grant exactly", () => {
    expect(choosePlan(bucket, ["code"], false)).toEqual({
      kind: "exact",
      line: ["code"],
      filled: [],
      residual: [],
    });
  });

  it("reads a version of a grant exactly", () => {
    expect(choosePlan(bucket, ["code", "currentConfigVersion"], false)).toEqual(
      {
        kind: "exact",
        line: ["code", "currentConfigVersion"],
        filled: [],
        residual: [],
      },
    );
  });

  it("reads a version without its grant in time order, checking each row", () => {
    expect(choosePlan(bucket, ["currentConfigVersion"], false)).toMatchObject({
      kind: "bounded",
      line: [],
      residual: ["currentConfigVersion"],
    });
  });

  it("groups by nothing, so its grants are a menu, and still draws the status in the position", () => {
    expect(bucket.groupings).toEqual([]);
    expect(bucket.title).toEqual({ label: "Reference", format: "mono" });
    expect(bucket.columns).toEqual([
      { key: "code", label: "Grant", format: "mono" },
      { key: "position", label: "Status", format: "position" },
    ]);
  });

  it("never projects answers, identifiers or metadata", () => {
    expect(bucket.row.projection).toEqual({
      clientRef: 1,
      code: 1,
      currentConfigVersion: 1,
      currentPhase: 1,
      currentStage: 1,
      currentStatus: 1,
    });
  });

  it("presents a row linked to its application page", () => {
    expect(
      bucket.row.present({
        clientRef: "abc-123",
        code: "example-grant",
        currentConfigVersion: "1.2.0",
        currentPhase: "PRE_AWARD",
        currentStage: "REVIEW",
        currentStatus: "IN_REVIEW",
      }),
    ).toEqual({
      title: "abc-123",
      subtitle: null,
      cells: {
        code: "example-grant@1.2.0",
        position: { phase: "PRE_AWARD", stage: "REVIEW", status: "IN_REVIEW" },
      },
      link: {
        kind: "application",
        code: "example-grant",
        clientRef: "abc-123",
      },
    });
  });

  it("presents the bare grant code for an application with no version", () => {
    expect(
      bucket.row.present({ clientRef: "abc-123", code: "example-grant" }).cells
        .code,
    ).toBe("example-grant");
  });

  it("presents null for a position the application does not hold", () => {
    expect(
      bucket.row.present({ clientRef: "abc-123", code: "example-grant" }).cells
        .position,
    ).toEqual({ phase: null, stage: null, status: null });
  });
});
