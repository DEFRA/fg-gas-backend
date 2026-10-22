import { STORED, defineBucket } from "../../common/buckets/bucket.js";
import { FetchStatus } from "../../common/fetch-status.js";
import { ConfigVersionStatus } from "../models/config-version.js";

const DEFINITION = "worstFetchStatus";

const statusValues = [
  {
    value: ConfigVersionStatus.Active,
    label: "Active",
    tone: "success",
    hint: "Published by the config broker.",
  },
  {
    value: ConfigVersionStatus.Draft,
    label: "Draft",
    tone: "neutral",
    hint: "Not yet published as active.",
  },
];

const fetchStatusValues = [
  {
    value: FetchStatus.Fetched,
    label: "Stored",
    tone: "success",
    hint: "GAS has loaded every file of this version (grant, agreement, payment).",
  },
  {
    value: FetchStatus.Pending,
    label: "Not stored yet",
    tone: "neutral",
    hint: "At least one of this version's files (grant, agreement, payment) isn't fetched by GAS yet. GAS fetches each one from S3 when it first needs it: the grant file only for the newest usable Active version of a major, the agreement and payment files whenever an agreement or claim on this version needs them. A file stored with Fetch definitions shows here until GAS loads it itself. Open the version to see which.",
  },
  {
    value: FetchStatus.TransientError,
    label: "Fetch error",
    tone: "warning",
    hint: "GAS's last fetch of at least one of this version's files from S3 failed. GAS tries again the next time it needs it; after 5 failed fetches of the grant file it stops trying and marks it Failed. Open the version for the error.",
  },
  {
    value: FetchStatus.PermanentError,
    label: "Failed",
    tone: "error",
    hint: "GAS couldn't fetch or read at least one of this version's files, or stopped after 5 failed fetches, and won't use it. What that stops depends on the file: open the version to see why and what it affects; publish a fixed version.",
  },
];

export const grantsBucket = () =>
  defineBucket({
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
    facts: {
      grantCode: { label: "Grant", param: "grant", values: STORED },
      status: { label: "Status", param: "status", values: statusValues },
      [DEFINITION]: {
        label: "Definition",
        param: "definition",
        values: fetchStatusValues,
      },
    },
    indexes: [
      ["grantCode", "status", DEFINITION],
      ["status", DEFINITION],
    ],
    audited: false,
    timeline: false,
    title: { label: "Grant", format: "mono" },
    columns: [
      { key: "version", label: "Version", format: "mono" },
      {
        key: "definition",
        label: "Definition",
        format: "badge",
        fact: DEFINITION,
      },
      { key: "status", label: "Status", format: "badge", fact: "status" },
    ],
    row: {
      projection: { grantCode: 1, version: 1, status: 1, [DEFINITION]: 1 },
      present: (doc) => ({
        title: doc.grantCode,
        subtitle: null,
        cells: {
          version: doc.version,
          status: doc.status,
          definition: doc.worstFetchStatus,
        },
        link: { kind: "grant", code: doc.grantCode, version: doc.version },
      }),
    },
  });
