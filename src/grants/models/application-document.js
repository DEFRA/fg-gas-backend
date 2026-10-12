export class ApplicationDocument {
  constructor(application) {
    this.currentPhase = application.position.phase;
    this.currentStage = application.position.stage;
    this.currentStatus = application.position.status;
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
  }
}
