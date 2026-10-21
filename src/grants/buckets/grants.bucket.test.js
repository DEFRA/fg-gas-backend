import { describe, expect, it } from "vitest";
import { STORED, indexKeysOf } from "../../common/buckets/bucket.js";
import { choosePlan } from "../../common/buckets/plan.js";
import { grantsBucket } from "./grants.bucket.js";

describe("gas.grants", () => {
  const bucket = grantsBucket();

  it("lists config versions by the time they were received, without auditing reads", () => {
    expect(bucket).toMatchObject({
      id: "gas.grants",
      path: "grants",
      label: "Grants",
      service: "GAS",
      shortLabel: "Grants",
      icon: "scroll-text",
      order: 75,
      noun: { one: "grant version", many: "grant versions" },
      collection: "config_versions",
      time: { field: "receivedAt", type: "isoString", label: "Received" },
      audited: false,
      timeline: false,
    });
  });

  it("filters by the stored grant codes, the status and the grant definition's fetch status", () => {
    expect(bucket.facts).toEqual({
      grantCode: {
        label: "Grant",
        values: STORED,
        toggle: null,
        param: "grant",
      },
      status: {
        label: "Status",
        values: [
          { value: "active", label: "Active", tone: "success" },
          { value: "draft", label: "Draft", tone: "neutral" },
        ],
        toggle: null,
        param: "status",
      },
      "definitions.grant.fetchStatus": {
        label: "Definition",
        values: [
          { value: "fetched", label: "Fetched", tone: "success" },
          { value: "pending", label: "Not fetched", tone: "info" },
          { value: "transient_error", label: "Retrying", tone: "warning" },
          { value: "permanent_error", label: "Failed", tone: "error" },
        ],
        toggle: null,
        param: "definition",
      },
    });
  });

  it("declares no ref kinds", () => {
    expect(bucket.refs).toEqual({});
  });

  it("declares the index keys of its lines", () => {
    expect(indexKeysOf(bucket)).toEqual([
      { receivedAt: -1, _id: -1 },
      {
        grantCode: 1,
        status: 1,
        "definitions.grant.fetchStatus": 1,
        receivedAt: -1,
        _id: -1,
      },
      {
        status: 1,
        "definitions.grant.fetchStatus": 1,
        receivedAt: -1,
        _id: -1,
      },
      { refs: 1, receivedAt: -1, _id: -1 },
    ]);
  });

  it.each([
    [[]],
    [["grantCode"]],
    [["status"]],
    [["definitions.grant.fetchStatus"]],
    [["grantCode", "status"]],
    [["grantCode", "definitions.grant.fetchStatus"]],
    [["status", "definitions.grant.fetchStatus"]],
    [["grantCode", "status", "definitions.grant.fetchStatus"]],
  ])("reads %j exactly", (asked) => {
    expect(choosePlan(bucket, asked, false).kind).toBe("exact");
  });

  it("groups by nothing, so its grants are a menu, and draws status and definition as badges", () => {
    expect(bucket.groupings).toEqual([]);
    expect(bucket.title).toEqual({ label: "Grant", format: "mono" });
    expect(bucket.columns).toEqual([
      { key: "version", label: "Version", format: "mono" },
      { key: "status", label: "Status", format: "badge", fact: "status" },
      {
        key: "definition",
        label: "Definition",
        format: "badge",
        fact: "definitions.grant.fetchStatus",
      },
    ]);
  });

  it("projects only what a row draws", () => {
    expect(bucket.row.projection).toEqual({
      grantCode: 1,
      version: 1,
      status: 1,
      "definitions.grant.fetchStatus": 1,
    });
  });

  it("presents a row linked to its grant version page", () => {
    expect(
      bucket.row.present({
        grantCode: "woodland-creation",
        version: "1.2.0",
        status: "active",
        definitions: { grant: { fetchStatus: "fetched" } },
      }),
    ).toEqual({
      title: "woodland-creation",
      subtitle: null,
      cells: { version: "1.2.0", status: "active", definition: "fetched" },
      link: { kind: "grant", code: "woodland-creation", version: "1.2.0" },
    });
  });

  it("presents a version whose definition fetch failed for good", () => {
    expect(
      bucket.row.present({
        grantCode: "woodland-creation",
        version: "2.0.0",
        status: "draft",
        definitions: { grant: { fetchStatus: "permanent_error" } },
      }).cells,
    ).toEqual({
      version: "2.0.0",
      status: "draft",
      definition: "permanent_error",
    });
  });
});
