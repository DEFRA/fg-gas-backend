export class Grant {
  code: string;
  metadata: {
    description: string;
    startDate: string;
  };
  actions: any;
  questions: any;
  phases?: any[];
  externalStatusMap?: ExternalStatusMap;

  constructor({
    code,
    metadata,
    actions,
    questions,
    phases,
    externalStatusMap,
  }) {
    this.code = code;
    this.metadata = {
      description: metadata.description,
      startDate: metadata.startDate,
    };
    this.actions = actions;
    this.questions = questions;
    this.phases = phases;
    this.externalStatusMap = externalStatusMap;
  }

  mapExternalStateToInternalState(
    currentPhase: string,
    currentStage: string,
    externalRequestedState: string,
    sourceSystem: string,
  ): ExternalStatusMapping {
    // Check if externalStatusMap exists
    if (!this.externalStatusMap || !this.externalStatusMap.phases) {
      return { valid: false };
    }

    // Find the current phase in the external status map
    const phaseMap = this.externalStatusMap.phases.find(
      (p) => p.code === currentPhase,
    );

    if (!phaseMap || !phaseMap.stages) {
      return { valid: false };
    }

    // Find the current stage in the phase
    const stageMap = phaseMap.stages.find((s) => s.code === currentStage);

    if (!stageMap || !stageMap.statuses) {
      return { valid: false };
    }

    // Find the status mapping that matches both the external code and source system
    const statusMapping = stageMap.statuses.find(
      (status) =>
        status.code === externalRequestedState &&
        status.source === sourceSystem,
    );

    if (!statusMapping || !statusMapping.mappedTo) {
      return { valid: false };
    }

    // Parse the mappedTo field to get target phase, stage, and status
    const mappedTo = statusMapping.mappedTo;
    let targetPhase: string;
    let targetStage: string;
    let targetStatus: string;

    if (mappedTo.startsWith("::")) {
      // Format: "::STATUS" - keep current phase and stage, only change status
      targetPhase = currentPhase;
      targetStage = currentStage;
      targetStatus = mappedTo.substring(2);
    } else if (mappedTo.includes(":")) {
      // Format: "PHASE:STAGE:STATUS" - full path specification
      const parts = mappedTo.split(":");
      if (parts.length === 3) {
        targetPhase = parts[0];
        targetStage = parts[1];
        targetStatus = parts[2];
      } else {
        // Invalid format
        return { valid: false };
      }
    } else {
      // Format: "STATUS" - just status code, keep current phase and stage
      targetPhase = currentPhase;
      targetStage = currentStage;
      targetStatus = mappedTo;
    }

    return {
      valid: true,
      targetPhase,
      targetStage,
      targetStatus,
    } as ValidExternalStatusMapping;
  }
}

export interface ExternalStatusMapping {
  valid: boolean;
}

export interface ValidExternalStatusMapping extends ExternalStatusMapping {
  valid: true;
  targetPhase: string;
  targetStage: string;
  targetStatus: string;
}

export interface InvalidExternalStatusMapping extends ExternalStatusMapping {
  valid: false;
}

// External Status Map structure interfaces
export interface ExternalStatusMap {
  phases: ExternalPhaseMap[];
}

export interface ExternalPhaseMap {
  code: string;
  stages: ExternalStageMap[];
}

export interface ExternalStageMap {
  code: string;
  statuses: ExternalStatusDefinition[];
}

export interface ExternalStatusDefinition {
  code: string;
  source: string;
  mappedTo: string;
}
