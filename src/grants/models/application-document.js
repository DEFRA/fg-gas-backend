export class ApplicationDocument {
  constructor(application) {
    this.clientRef = application.clientRef;
    this.code = application.code;
    this.createdAt = application.createdAt;
    this.submittedAt = application.submittedAt;
    this.identifiers = {
      sbi: application.identifiers.sbi,
      frn: application.identifiers.frn,
      crn: application.identifiers.crn,
      defraId: application.identifiers.defraId,
    };
    this.answers = application.answers;
    this.status = application.status;
    this.currentStage = application.currentStage;
    this.currentPhase = application.currentPhase;
    this.agreements = application.agreements || {};
  }
}
