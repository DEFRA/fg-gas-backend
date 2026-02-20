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
    this.identifiers = application.identifiers;
    this.metadata = application.metadata;
    this.phases = application.phases;
    this.agreements = application.agreements;
    this.replacementAllowed = application.replacementAllowed;
  }
}
