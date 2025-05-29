export class Application {
  constructor({
    clientRef,
    code,
    createdAt,
    submittedAt,
    identifiers,
    answers,
  }) {
    this.clientRef = clientRef;
    this.code = code;
    this.createdAt = createdAt ?? new Date().toISOString();
    this.submittedAt = submittedAt;
    this.identifiers = identifiers;
    this.answers = answers;
  }
}
