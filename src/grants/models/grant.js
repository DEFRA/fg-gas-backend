// Constants for fully qualified status path format: "PHASE:STAGE:STATUS"
const FULLY_QUALIFIED_STATUS_PARTS_COUNT = 3;

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

  // Helper methods to navigate the hierarchy
  #findPhase(phases, phaseCode) {
    return phases?.find((p) => p.code === phaseCode);
  }

  #findStage(phase, stageCode) {
    return phase?.stages?.find((s) => s.code === stageCode);
  }

  #findStatus(stage, statusCode) {
    return stage?.statuses?.find((s) => s.code === statusCode);
  }

  #findPhaseStage(phases, phaseCode, stageCode) {
    const phase = this.#findPhase(phases, phaseCode);
    const stage = this.#findStage(phase, stageCode);
    return { phase, stage };
  }

  #findPhaseStageStatus(phases, phaseCode, stageCode, statusCode) {
    const { phase, stage } = this.#findPhaseStage(phases, phaseCode, stageCode);
    const status = this.#findStatus(stage, statusCode);
    return { phase, stage, status };
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

  #matchesExternalStatus(status, externalRequestedState, sourceSystem) {
    return (
      status.code === externalRequestedState && status.source === sourceSystem
    );
  }

  // eslint-disable-next-line complexity
  #findExternalStatusMapping(
    currentPhase,
    currentStage,
    externalRequestedState,
    sourceSystem,
  ) {
    const { stage: stageMap } = this.#findPhaseStage(
      this.externalStatusMap?.phases,
      currentPhase,
      currentStage,
    );

    const statusMapping = stageMap?.statuses?.find((status) =>
      this.#matchesExternalStatus(status, externalRequestedState, sourceSystem),
    );

    if (!statusMapping?.mappedTo) {
      return null;
    }

    return statusMapping;
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
      if (parts.length === FULLY_QUALIFIED_STATUS_PARTS_COUNT) {
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
      return { valid: false, processes: [] };
    }

    if (!statusDef.validFrom || statusDef.validFrom.length === 0) {
      return {
        valid: true,
        processes: statusDef.processes || [],
      };
    }

    const normalisedValidFrom = this.#normaliseValidFrom(statusDef);

    const isValid = this.#findMatchingValidFromEntry(
      normalisedValidFrom,
      currentStatus,
    );

    return {
      valid: !!isValid,
      processes: isValid ? isValid.processes || [] : [],
    };
  }

  #findStatusDefinition(targetPhase, targetStage, targetStatus) {
    const { status } = this.#findPhaseStageStatus(
      this.phases,
      targetPhase,
      targetStage,
      targetStatus,
    );
    return status;
  }

  #normaliseValidFrom(statusDef) {
    const statusLevelProcesses = Array.isArray(statusDef.processes)
      ? statusDef.processes
      : [];

    return (statusDef.validFrom || []).map((v) => {
      if (typeof v === "string") {
        return { code: v, processes: statusLevelProcesses };
      }
      return {
        code: v.code,
        processes: Array.isArray(v.processes) ? v.processes : [],
      };
    });
  }

  // eslint-disable-next-line complexity
  #findMatchingValidFromEntry(validFromEntries, currentStatus) {
    const currentStatusCode = currentStatus.includes(":")
      ? currentStatus.split(":").pop()
      : currentStatus;

    for (const entry of validFromEntries) {
      const code = entry.code;
      if (typeof code !== "string") continue;

      if (code.includes(":")) {
        if (code === currentStatus) {
          return entry;
        }
      } else if (code === currentStatusCode) {
        return entry;
      }
    }

    return null;
  }

  findStatuses(position) {
    const { stage } = this.#findPhaseStage(
      this.phases,
      position.phase,
      position.stage,
    );

    const statuses = stage?.statuses || [];

    // Convert array to object map for easier lookup
    const statusMap = {};
    statuses.forEach((status) => {
      statusMap[status.code] = status;
    });

    return statusMap;
  }
}
