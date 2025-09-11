export class ApplicationDocument {
  constructor(application) {
    this.phase = application.phase;
    this.stage = application.stage;
    this.status = application.status;
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
    this.answers = application.answers;
  }
}
