export class Grant {
  constructor({ code, metadata, actions, questions }) {
    this.code = code;
    this.metadata = {
      description: metadata.description,
      startDate: metadata.startDate,
    };
    this.actions = actions;
    this.questions = questions;
  }
}
