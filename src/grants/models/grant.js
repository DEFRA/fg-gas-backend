export class Grant {
  constructor({ code, metadata, actions, phases, externalStatusMap }) {
    this.code = code;
    this.metadata = {
      description: metadata.description,
      startDate: metadata.startDate,
    };
    this.actions = actions;
    this.phases = phases;
    this.externalStatusMap = externalStatusMap;
  }

  get hasPhases() {
    return Boolean(this.phases && this.phases.length > 0);
  }

  getInitialState() {
    if (!this.hasPhases) {
      throw new Error(`Grant "${this.code}" has no phases defined`);
    }

    const [phase] = this.phases;
    const [stage] = phase.stages;
    const [status] = stage.statuses;

    return {
      phase,
      stage,
      status,
    };
  }

  mapExternalStateToInternalState(
    currentPhase,
    currentStage,
    externalRequestedState,
    sourceSystem,
  ) {
    const statusMapping = this.#findExternalStatusMapping(
      currentPhase,
      currentStage,
      externalRequestedState,
      sourceSystem,
    );

    if (!statusMapping) {
      return { valid: false };
    }

    return this.#parseMappedToField(
      statusMapping.mappedTo,
      currentPhase,
      currentStage,
    );
  }

  // eslint-disable-next-line complexity
  #findExternalStatusMapping(
    currentPhase,
    currentStage,
    externalRequestedState,
    sourceSystem,
  ) {
    const phaseMap = this.externalStatusMap?.phases?.find(
      (p) => p.code === currentPhase,
    );
    const stageMap = phaseMap?.stages?.find((s) => s.code === currentStage);
    const statusMapping = stageMap?.statuses?.find(
      (status) =>
        status.code === externalRequestedState &&
        status.source === sourceSystem,
    );
    return statusMapping?.mappedTo ? statusMapping : null;
  }

  #parseMappedToField(mappedTo, currentPhase, currentStage) {
    if (mappedTo.startsWith("::")) {
      // Format: "::STATUS" - keep current phase and stage, only change status
      return {
        valid: true,
        targetPhase: currentPhase,
        targetStage: currentStage,
        targetStatus: mappedTo.substring(2),
      };
    }

    if (mappedTo.includes(":")) {
      // Format: "PHASE:STAGE:STATUS" - full path specification
      const parts = mappedTo.split(":");
      if (parts.length === 3) {
        return {
          valid: true,
          targetPhase: parts[0],
          targetStage: parts[1],
          targetStatus: parts[2],
        };
      }
      return { valid: false };
    }

    // Format: "STATUS" - just status code, keep current phase and stage
    return {
      valid: true,
      targetPhase: currentPhase,
      targetStage: currentStage,
      targetStatus: mappedTo,
    };
  }

  // eslint-disable-next-line complexity
  isValidTransition(targetPhase, targetStage, targetStatus, currentStatus) {
    const statusDef = this.#findStatusDefinition(
      targetPhase,
      targetStage,
      targetStatus,
    );

    if (!statusDef) {
      return { valid: false, entryProcesses: [] };
    }

    // If there's no validFrom, the transition is always valid
    if (!statusDef.validFrom || statusDef.validFrom.length === 0) {
      return {
        valid: true,
        entryProcesses: statusDef.entryProcesses || [],
      };
    }

    // Check if current status is in validFrom array
    const isValid = this.#isValidFromMatch(statusDef.validFrom, currentStatus);

    return {
      valid: isValid,
      entryProcesses: isValid ? statusDef.entryProcesses || [] : [],
    };
  }

  // eslint-disable-next-line complexity
  #findStatusDefinition(targetPhase, targetStage, targetStatus) {
    const phase = this.phases?.find((p) => p.code === targetPhase);
    const stage = phase?.stages?.find((s) => s.code === targetStage);
    return stage?.statuses?.find((s) => s.code === targetStatus);
  }

  #isValidFromMatch(validFrom, currentStatus) {
    return validFrom.some((validFromStatus) => {
      if (validFromStatus.includes(":")) {
        // Fully qualified status like "PRE_AWARD:REVIEW_APPLICATION:APPROVED"
        return validFromStatus === currentStatus;
      }
      // Simple status code - extract just the status part from currentStatus
      const currentStatusCode = currentStatus.includes(":")
        ? currentStatus.split(":").pop()
        : currentStatus;
      return validFromStatus === currentStatusCode;
    });
  }

  // eslint-disable-next-line complexity
  findStatuses(position) {
    const phase = this.phases?.find((p) => p.code === position.phase);
    const stage = phase?.stages?.find((s) => s.code === position.stage);
    const statuses = stage?.statuses || [];

    // Convert array to object map for easier lookup
    const statusMap = {};
    statuses.forEach((status) => {
      statusMap[status.code] = status;
    });

    return statusMap;
  }
}
