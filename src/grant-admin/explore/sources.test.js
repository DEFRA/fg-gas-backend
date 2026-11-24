import { beforeEach, describe, expect, it } from "vitest";
import { registerGasExploreSources } from "../../../test/helpers/explore-sources.js";
import { pathProblem } from "../../common/explore/paths.js";
import { findExploreSource } from "../../common/explore-sources/registry.js";
import { inboxBucket } from "../../events/buckets/inbox.bucket.js";
import { outboxBucket } from "../../events/buckets/outbox.bucket.js";
import { applicationsBucket } from "../../grants/buckets/applications.bucket.js";
import { grantsBucket } from "../../grants/buckets/grants.bucket.js";
import { findOwnSource, ownSources } from "./sources.js";

const BUCKETS = {
  "gas.applications": applicationsBucket(),
  "gas.grants": grantsBucket(),
  "gas.outbox": outboxBucket(),
  "gas.inbox": inboxBucket(),
};

const bucketsOf = (source) =>
  source.boxes
    ? source.boxes.map(({ bucket }) => BUCKETS[bucket])
    : [BUCKETS[source.bucket]].filter(Boolean);

const declaresRef = (bucket, kind) =>
  Object.hasOwn(bucket.refs, kind) || bucket.links.includes(kind);

// The paths each of GAS's sources suggests, by source: a new source or path
// is a change here. Every well-formed path is read.
const KNOWN = {
  applications: {
    paths: [
      "_id",
      "clientRef",
      "code",
      "currentConfigVersion",
      "createdAt",
      "refs",
      "identifiers.sbi",
      "identifiers.frn",
      "identifiers.crn",
      "currentPhase",
      "currentStage",
      "currentStatus",
      "originalConfigVersion",
      "updatedAt",
      "submittedAt",
      "phases.code",
      "agreements",
    ],
  },
  grants: {
    paths: [
      "_id",
      "grantCode",
      "version",
      "major",
      "status",
      "worstFetchStatus",
      "receivedAt",
      "definitions.grant.fetchStatus",
      "definition.phases.code",
      "definition.phases.stages.code",
    ],
  },
  events: {
    paths: [
      "_id",
      "publicationDate",
      "service",
      "box",
      "eventType",
      "status",
      "errorKey",
      "lastError.name",
      "refs",
      "event.id",
      "event.type",
      "event.source",
      "event.time",
      "event.data.clientRef",
      "event.data.code",
      "event.data.caseRef",
      "event.data.workflowCode",
      "event.data.agreementNumber",
      "event.data.identifiers.sbi",
      "event.data.newStatus",
      "target",
      "lastError.message",
      "completionAttempts",
      "completionDate",
    ],
  },
  agreements: {
    paths: [
      "_id",
      "agreementNumber",
      "clientRef",
      "code",
      "identifiers.sbi",
      "state",
      "createdAt",
      "startDate",
      "endDate",
      "totalAmountPence",
      "actions.code",
      "actions.quantity",
    ],
  },
  payments: {
    paths: [
      "_id",
      "invoiceNumber",
      "source.agreementNumber",
      "source.clientRef",
      "source.code",
      "agreement.clientRef",
      "agreement.code",
      "sbi",
      "frn",
      "payments.status",
      "payments.dueDate",
      "payments.totalAmountPence",
      "totalAmountPence",
      "marketingYear",
      "createdAt",
    ],
  },
};

describe("GAS's Explore sources", () => {
  beforeEach(() => {
    registerGasExploreSources();
  });

  it("are those registered, each with the paths it suggests", () => {
    expect(
      Object.fromEntries(
        ownSources().map(({ name, paths }) => [
          name,
          { paths: paths.map(({ path }) => path) },
        ]),
      ),
    ).toEqual(KNOWN);
    expect(ownSources().filter((source) => "roots" in source)).toEqual([]);
  });

  it("declare _id with its stored type, read through the _id index on a big source", () => {
    const idOf = (name) =>
      findOwnSource(name).paths.find(({ path }) => path === "_id");

    expect(idOf("applications")).toEqual({
      path: "_id",
      type: "objectId",
      index: { id: true },
    });
    expect(idOf("events")).toEqual(idOf("applications"));
    expect(idOf("grants")).toEqual({ path: "_id", type: "objectId" });
    expect(idOf("agreements")).toEqual({ path: "_id", type: "text" });
    expect(idOf("payments")).toEqual({ path: "_id", type: "text" });
  });

  it("finds a registered source by name, or none", () => {
    expect(findOwnSource("payments").name).toBe("payments");
    expect(findOwnSource("cases")).toBeNull();
  });

  it.each(["applications", "grants", "events"])(
    "%s reads only facts, ref kinds and times its buckets declare",
    (name) => {
      const source = findExploreSource(name);
      const buckets = bucketsOf(source);

      expect(buckets.length).toBeGreaterThan(0);
      source.paths
        .filter(({ index }) => index)
        .forEach(({ path, index }) =>
          buckets.forEach((bucket) => {
            const declared = [
              !index.fact || Object.hasOwn(bucket.facts, index.fact),
              !index.ref || declaresRef(bucket, index.ref),
              !index.time || bucket.time.field === path,
            ];

            expect([path, declared]).toEqual([path, [true, true, true]]);
          }),
        );
    },
  );

  it.each(Object.keys(KNOWN))(
    "%s knows each path once, every one and its columns well formed, and opens a record",
    (name) => {
      const source = findOwnSource(name);
      const paths = source.paths.map(({ path }) => path);

      expect(new Set(paths).size).toBe(paths.length);
      expect(paths.filter((path) => pathProblem(path))).toEqual([]);
      expect(source.star.filter((path) => pathProblem(path))).toEqual([]);
      expect(pathProblem(source.time)).toBeNull();
      expect(typeof source.open).toBe("function");
    },
  );

  it.each([
    "definition.actions.url",
    "definitions.grant.s3Key",
    "event.audit.details.security.actor.email",
    "event.ip",
    "claimedBy",
    "agreement.somethingNew",
    "comments.text",
  ])("reads %s, as nothing stored is withheld", (path) => {
    expect(pathProblem(path)).toBeNull();
  });

  it("opens an application from a payment through its agreement, or nothing", () => {
    expect(
      findOwnSource("payments").open({
        source: {},
        agreement: { code: "g", clientRef: "r" },
      }),
    ).toEqual({ kind: "application", code: "g", ref: "r" });
    expect(
      findOwnSource("payments").open({ source: {}, agreement: null }),
    ).toBeNull();
  });
});
