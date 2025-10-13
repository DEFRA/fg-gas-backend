export class ApplicationDocument {
  constructor(application) {
    this.currentPhase = application.currentPhase;
    this.currentStage = application.currentStage;
    this.currentStatus = application.currentStatus;
    this.clientRef = application.clientRef;
    this.code = application.code;
    this.createdAt = application.createdAt;
    this.updatedAt = application.updatedAt;
    this.submittedAt = application.submittedAt;
    this.identifiers = {
      sbi: application.identifiers.sbi,
      frn: application.identifiers.frn,
      crn: application.identifiers.crn,
      defraId: application.identifiers.defraId,
    };
    this.phases = application.phases;
    this.agreements = application.agreements;
  }
}
