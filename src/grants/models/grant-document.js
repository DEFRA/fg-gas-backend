export class GrantDocument {
  constructor(grant) {
    this.code = grant.code;
    this.metadata = grant.metadata;
    this.actions = grant.actions;
    this.questions = grant.questions;
  }
}
