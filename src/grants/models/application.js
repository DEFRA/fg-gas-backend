export const ApplicationPhase = {
  PreAward: "PRE_AWARD",
};

export const ApplicationStage = {
  Assessment: "ASSESSMENT",
};

export const ApplicationStatus = {
  Received: "RECEIVED",
};

export class Application {
  constructor({
    phase,
    stage,
    status,
    clientRef,
    code,
    createdAt,
    updatedAt,
    submittedAt,
    identifiers,
    answers,
  }) {
    this.phase = phase;
    this.stage = stage;
    this.status = status;
    this.clientRef = clientRef;
    this.code = code;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
    this.submittedAt = submittedAt;
    this.identifiers = identifiers;
    this.answers = answers;
  }

  static new({ clientRef, code, submittedAt, identifiers, answers }) {
    const createdAt = new Date().toISOString();

    return new Application({
      phase: ApplicationPhase.PreAward,
      stage: ApplicationStage.Assessment,
      status: ApplicationStatus.Received,
      clientRef,
      code,
      submittedAt,
      createdAt,
      updatedAt: createdAt,
      identifiers,
      answers,
    });
  }
}
