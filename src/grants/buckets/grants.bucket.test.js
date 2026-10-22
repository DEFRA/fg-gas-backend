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

  it("filters by the stored grant codes, the status and the worst fetch status of a version's files", () => {
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
          {
            value: "active",
            label: "Active",
            tone: "success",
            hint: "Published by the config broker.",
          },
          {
            value: "draft",
            label: "Draft",
            tone: "neutral",
            hint: "Not yet published as active.",
          },
        ],
        toggle: null,
        param: "status",
      },
      worstFetchStatus: {
        label: "Definition",
        values: [
          expect.objectContaining({
            value: "fetched",
            label: "Stored",
            tone: "success",
          }),
          expect.objectContaining({
            value: "pending",
            label: "Not stored yet",
            tone: "neutral",
          }),
          expect.objectContaining({
            value: "transient_error",
            label: "Fetch error",
            tone: "warning",
          }),
          expect.objectContaining({
            value: "permanent_error",
            label: "Failed",
            tone: "error",
          }),
        ],
        toggle: null,
        param: "definition",
      },
    });
  });

  it("explains each definition value", () => {
    const hints = bucket.facts.worstFetchStatus.values.map(({ hint }) => hint);

    expect(hints).toEqual([
      "GAS has loaded every file of this version (grant, agreement, payment).",
      expect.stringContaining(
        "the grant file only for the newest usable Active version of a major, the agreement and payment files whenever an agreement or claim on this version needs them.",
      ),
      expect.stringContaining(
        "GAS tries again the next time it needs it; after 5 failed fetches of the grant file it stops trying and marks it Failed.",
      ),
      expect.stringContaining(
        "GAS couldn't fetch or read at least one of this version's files, or stopped after 5 failed fetches, and won't use it.",
      ),
    ]);
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
        worstFetchStatus: 1,
        receivedAt: -1,
        _id: -1,
      },
      {
        status: 1,
        worstFetchStatus: 1,
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
    [["worstFetchStatus"]],
    [["grantCode", "status"]],
    [["grantCode", "worstFetchStatus"]],
    [["status", "worstFetchStatus"]],
    [["grantCode", "status", "worstFetchStatus"]],
  ])("reads %j exactly", (asked) => {
    expect(choosePlan(bucket, asked, false).kind).toBe("exact");
  });

  it("groups by nothing, so its grants are a menu, and draws the definition then the status as badges", () => {
    expect(bucket.groupings).toEqual([]);
    expect(bucket.title).toEqual({ label: "Grant", format: "mono" });
    expect(bucket.columns).toEqual([
      { key: "version", label: "Version", format: "mono" },
      {
        key: "definition",
        label: "Definition",
        format: "badge",
        fact: "worstFetchStatus",
      },
      { key: "status", label: "Status", format: "badge", fact: "status" },
    ]);
  });

  it("projects only what a row draws", () => {
    expect(bucket.row.projection).toEqual({
      grantCode: 1,
      version: 1,
      status: 1,
      worstFetchStatus: 1,
    });
  });

  it("presents a row linked to its grant version page", () => {
    expect(
      bucket.row.present({
        grantCode: "woodland-creation",
        version: "1.2.0",
        status: "active",
        worstFetchStatus: "fetched",
      }),
    ).toEqual({
      title: "woodland-creation",
      subtitle: null,
      cells: { version: "1.2.0", status: "active", definition: "fetched" },
      link: { kind: "grant", code: "woodland-creation", version: "1.2.0" },
    });
  });

  it("presents a version one of whose files failed for good", () => {
    expect(
      bucket.row.present({
        grantCode: "woodland-creation",
        version: "2.0.0",
        status: "draft",
        definitions: {
          grant: { fetchStatus: "fetched" },
          agreement: { fetchStatus: "permanent_error" },
        },
        worstFetchStatus: "permanent_error",
      }).cells,
    ).toEqual({
      version: "2.0.0",
      status: "draft",
      definition: "permanent_error",
    });
  });
});
