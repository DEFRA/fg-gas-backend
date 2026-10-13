import { STORED, defineBucket } from "../../common/buckets/bucket.js";

const orNull = (value) => value ?? null;

const toPosition = (doc) => ({
  phase: orNull(doc.currentPhase),
  stage: orNull(doc.currentStage),
  status: orNull(doc.currentStatus),
});

export const applicationsBucket = () =>
  defineBucket({
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
    facts: {
      code: { label: "Grant", param: "grant", values: STORED },
    },
    refs: {
      ref: "Reference",
      sbi: "SBI",
      frn: "FRN",
      crn: "CRN",
      agreement: "Agreement number",
    },
    indexes: [["code"]],
    audited: true,
    timeline: false,
    title: { label: "Reference", format: "mono" },
    columns: [
      { key: "code", label: "Grant", format: "mono" },
      { key: "position", label: "Status", format: "position" },
    ],
    row: {
      projection: {
        clientRef: 1,
        code: 1,
        currentPhase: 1,
        currentStage: 1,
        currentStatus: 1,
      },
      present: (doc) => ({
        title: orNull(doc.clientRef),
        subtitle: null,
        cells: { code: orNull(doc.code), position: toPosition(doc) },
        link: {
          kind: "application",
          code: doc.code,
          clientRef: doc.clientRef,
        },
      }),
    },
  });
