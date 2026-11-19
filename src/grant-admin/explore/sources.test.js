import { beforeEach, describe, expect, it } from "vitest";
import { registerGasExploreSources } from "../../../test/helpers/explore-sources.js";
import { parsePath, pathProblem } from "../../common/explore/paths.js";
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

// Everything a query may read of GAS's records, by source: a new source, root
// or path is a change here.
const READABLE = {
  applications: {
    roots: [
      "clientRef",
      "code",
      "currentConfigVersion",
      "originalConfigVersion",
      "currentPhase",
      "currentStage",
      "currentStatus",
      "createdAt",
      "updatedAt",
      "submittedAt",
      "identifiers",
      "metadata",
      "phases",
      "agreements",
      "refs",
    ],
    paths: [
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
    roots: [
      "grantCode",
      "version",
      "major",
      "minor",
      "patch",
      "status",
      "worstFetchStatus",
      "receivedAt",
      "definitions.grant.fetchStatus",
      "definitions.agreement.fetchStatus",
      "definitions.payment.fetchStatus",
      "definition.code",
      "definition.version",
      "definition.metadata",
      "definition.phases",
      "definition.externalStatusMap",
      "definition.amendablePositions",
    ],
    paths: [
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
    roots: [
      "eventType",
      "status",
      "publicationDate",
      "eventTime",
      "target",
      "type",
      "source",
      "messageId",
      "event.id",
      "event.type",
      "event.source",
      "event.time",
      "event.specversion",
      "event.datacontenttype",
      "event.data",
      "completionAttempts",
      "completionDate",
      "lastResubmissionDate",
      "lastError",
      "errorKey",
      "refs",
    ],
    paths: [
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
    roots: [
      "agreementNumber",
      "version",
      "code",
      "clientRef",
      "configVersion",
      "correlationId",
      "identifiers",
      "state",
      "name",
      "schemeCode",
      "createdAt",
      "updatedAt",
      "acceptedAt",
      "startDate",
      "endDate",
      "totalAmountPence",
      "actions",
      "items",
      "parcels",
      "application",
      "applicant",
      "paymentSchedule",
      "payload",
      "supplementaryData",
    ],
    paths: [
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
    roots: [
      "invoiceNumber",
      "originalInvoiceNumber",
      "paymentRequestNumber",
      "source",
      "sbi",
      "frn",
      "scheme",
      "marketingYear",
      "ledger",
      "currency",
      "totalAmountPence",
      "payments",
      "createdAt",
      "agreement.agreementNumber",
      "agreement.version",
      "agreement.code",
      "agreement.clientRef",
      "agreement.configVersion",
      "agreement.correlationId",
      "agreement.identifiers",
      "agreement.state",
      "agreement.name",
      "agreement.schemeCode",
      "agreement.createdAt",
      "agreement.updatedAt",
      "agreement.acceptedAt",
      "agreement.startDate",
      "agreement.endDate",
      "agreement.totalAmountPence",
      "agreement.actions",
      "agreement.items",
      "agreement.parcels",
      "agreement.application",
      "agreement.applicant",
      "agreement.paymentSchedule",
      "agreement.payload",
      "agreement.supplementaryData",
    ],
    paths: [
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

const rootsOf = (source) => [
  ...source.roots,
  ...Object.keys(source.added ?? {}),
];

describe("GAS's Explore sources", () => {
  beforeEach(() => {
    registerGasExploreSources();
  });

  it("are those registered, each with the roots and paths it reads", () => {
    expect(
      Object.fromEntries(
        ownSources().map(({ name, roots, paths }) => [
          name,
          { roots, paths: paths.map(({ path }) => path) },
        ]),
      ),
    ).toEqual(READABLE);
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

  it.each(Object.keys(READABLE))(
    "%s knows each path once, every one and its columns readable, and opens a record",
    (name) => {
      const source = findOwnSource(name);
      const paths = source.paths.map(({ path }) => path);
      const lists = { roots: rootsOf(source) };

      expect(new Set(paths).size).toBe(paths.length);
      expect(paths.filter((path) => pathProblem(path, lists))).toEqual([]);
      expect(source.star.filter((path) => pathProblem(path, lists))).toEqual(
        [],
      );
      expect(pathProblem(source.time, lists)).toBeNull();
      expect(typeof source.open).toBe("function");
    },
  );

  it.each(Object.keys(READABLE))(
    "%s roots are well formed and none denied",
    (name) => {
      expect(
        findOwnSource(name).roots.filter((root) => parsePath(root) === null),
      ).toEqual([]);
    },
  );

  it("reads an agreement through a payment only where agreements may be read", () => {
    const lists = { roots: findOwnSource("payments").roots };

    expect(pathProblem("agreement.clientRef", lists)).toBeNull();
    expect(pathProblem("agreement.applicant.business.name", lists)).toBeNull();
    expect(pathProblem("agreement.somethingNew", lists)).not.toBeNull();
    expect(
      findOwnSource("agreements").roots.every(
        (root) => pathProblem(`agreement.${root}`, lists) === null,
      ),
    ).toBe(true);
  });

  it("reads a grant's stored definition, but never its actions", () => {
    const lists = { roots: findOwnSource("grants").roots };

    expect(pathProblem("definition.phases.questions.title", lists)).toBeNull();
    expect(pathProblem("definition.actions.url", lists)).not.toBeNull();
    expect(pathProblem("definition.actions.name", lists)).not.toBeNull();
    expect(pathProblem("definitions.grant.s3Key", lists)).not.toBeNull();
  });

  it("reads an event's message, but never an audit's actor or address", () => {
    const lists = { roots: rootsOf(findOwnSource("events")) };

    expect(pathProblem("event.data.clientRef", lists)).toBeNull();
    expect(pathProblem("service", lists)).toBeNull();
    expect(
      pathProblem("event.audit.details.security.actor.email", lists),
    ).not.toBeNull();
    expect(pathProblem("event.ip", lists)).not.toBeNull();
    expect(pathProblem("claimedBy", lists)).not.toBeNull();
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
