import { toRefs } from "../../common/buckets/refs.js";

export const applicationRefs = ({ clientRef, identifiers, agreements }) => {
  const { sbi, frn, crn } = { ...identifiers };

  return toRefs([
    ["ref", clientRef],
    ["sbi", sbi],
    ["frn", frn],
    ["crn", crn],
    ...Object.keys({ ...agreements }).map((number) => ["agreement", number]),
  ]);
};

export const seriesRefs = (clientRefs) =>
  toRefs(clientRefs.map((clientRef) => ["ref", clientRef]));

export class ApplicationDocument {
  constructor(application) {
    this.currentPhase = application.currentPhase;
    this.currentStage = application.currentStage;
    this.currentStatus = application.currentStatus;
    this.clientRef = application.clientRef;
    this.code = application.code;
    this.originalConfigVersion = application.originalConfigVersion;
    this.currentConfigVersion = application.currentConfigVersion;
    this.createdAt = application.createdAt;
    this.updatedAt = application.updatedAt;
    this.submittedAt = application.submittedAt;
    this.identifiers = application.identifiers;
    this.metadata = application.metadata;
    this.phases = application.phases;
    this.agreements = application.agreements;
    this.refs = applicationRefs(application);
  }
}
