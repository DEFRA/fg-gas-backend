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

  mapExternalStateToInternalState(currentPhase, currentStage, externalRequestedState, sourceSystem) : ExternalStatusMapping {
    throw new Error("Method not implemented.");
  }

}

export interface ExternalStatusMapping { valid: boolean}

export interface ValidExternalStatusMapping extends ExternalStatusMapping {
  valid: true
  targetPhase: string;
  targetStage: string;
  targetStatus: string;
}

export interface InvalidExternalStatusMapping extends ExternalStatusMapping {
  valid: false;
}
