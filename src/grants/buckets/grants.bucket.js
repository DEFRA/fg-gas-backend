import { STORED, defineBucket } from "../../common/buckets/bucket.js";
import { FetchStatus } from "../../common/fetch-status.js";
import { ConfigVersionStatus } from "../models/config-version.js";

const DEFINITION = "definitions.grant.fetchStatus";

const statusValues = [
  { value: ConfigVersionStatus.Active, label: "Active", tone: "success" },
  { value: ConfigVersionStatus.Draft, label: "Draft", tone: "neutral" },
];

const fetchStatusValues = [
  { value: FetchStatus.Fetched, label: "Fetched", tone: "success" },
  { value: FetchStatus.Pending, label: "Not fetched", tone: "info" },
  { value: FetchStatus.TransientError, label: "Retrying", tone: "warning" },
  { value: FetchStatus.PermanentError, label: "Failed", tone: "error" },
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
      { key: "status", label: "Status", format: "badge", fact: "status" },
      {
        key: "definition",
        label: "Definition",
        format: "badge",
        fact: DEFINITION,
      },
    ],
    row: {
      projection: { grantCode: 1, version: 1, status: 1, [DEFINITION]: 1 },
      present: (doc) => ({
        title: doc.grantCode,
        subtitle: null,
        cells: {
          version: doc.version,
          status: doc.status,
          definition: doc.definitions.grant.fetchStatus,
        },
        link: { kind: "grant", code: doc.grantCode, version: doc.version },
      }),
    },
  });
