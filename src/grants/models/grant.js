import Boom from "@hapi/boom";
import { EntitlementTemplate } from "./entitlement-template.js";

// Constants for fully qualified status path format: "PHASE:STAGE:STATUS"
const FULLY_QUALIFIED_STATUS_PARTS_COUNT = 3;

export class Grant {
  constructor({
    code,
    version,
    metadata,
    actions,
    phases,
    externalStatusMap,
    amendablePositions,
    entitlementTemplates,
  }) {
    this.code = code;
    this.version = version;
    this.metadata = {
      description: metadata.description,
      startDate: metadata.startDate,
    };
    this.actions = actions;
    this.phases = phases;
    this.externalStatusMap = externalStatusMap;
    this.amendablePositions = amendablePositions;
    this.entitlementTemplates = entitlementTemplates?.map(
      (template) => new EntitlementTemplate(template),
    );

    this.#assertEntitlementTemplateCodesUnique();
    this.#assertEntitlementTemplatePositionsExist();
  }

  findEntitlementTemplate(code) {
    return this.entitlementTemplates?.find(
      (template) => template.code === code,
    );
  }

  // findEntitlementTemplate returns the first match, so a duplicated code would
  // silently half-ignore one of the definitions. The array Joi schema enforces
  // this for the admin API; the S3 ingest path builds each template
  // individually, so the aggregate has to enforce it too.
  #assertEntitlementTemplateCodesUnique() {
    const codes = new Set();

    for (const template of this.entitlementTemplates ?? []) {
      if (codes.has(template.code)) {
        throw Boom.badImplementation(
          `Duplicate entitlement template code "${template.code}"`,
        );
      }

      codes.add(template.code);
    }
  }

  #assertEntitlementTemplatePositionsExist() {
    for (const template of this.entitlementTemplates ?? []) {
      for (const position of template.referencedPositions()) {
        this.#assertPositionExists(template.code, position);
      }
    }
  }

  #assertPositionExists(templateCode, position) {
    const parts = position.split(":");
    // A trailing or extra segment would still destructure to a resolvable
    // phase/stage/status here, but isAvailableFor*At compares the raw string,
    // so it could never match a real position - reject it at ingest instead.
    const [phaseCode, stageCode, statusCode] = parts;
    const { status } =
      parts.length === FULLY_QUALIFIED_STATUS_PARTS_COUNT
        ? this.#findPhaseStageStatus(
            this.phases,
            phaseCode,
            stageCode,
            statusCode,
          )
        : {};

    if (!status) {
      throw Boom.badImplementation(
        `Entitlement template "${templateCode}" references position "${position}" which does not match any phase:stage:status in "phases"`,
      );
    }
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

  hasExternalStatusMapping(
    externalRequestedState,
    source,
    currentPhase,
    currentStage,
  ) {
    return this.#findExternalStatusMapping(
      currentPhase,
      currentStage,
      externalRequestedState,
      source,
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
    const statusDef = this.findStatusDefinition(
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

    const isValid = this.#isValidFromMatch(statusDef.validFrom, currentStatus);

    return {
      valid: !!isValid,
      processes: isValid?.processes,
    };
  }

  findStatusDefinition(targetPhase, targetStage, targetStatus) {
    const { status } = this.#findPhaseStageStatus(
      this.phases,
      targetPhase,
      targetStage,
      targetStatus,
    );
    return status;
  }

  #isValidFromMatch(validFrom, currentStatus) {
    return validFrom.find((entry) => {
      if (entry.code.includes(":")) {
        // Fully qualified status like "PRE_AWARD:REVIEW_APPLICATION:APPROVED"
        return entry.code === currentStatus;
      }

      // Simple status code - extract just the status part from currentStatus
      const currentStatusCode = currentStatus.split(":").pop();
      return entry.code === currentStatusCode;
    });
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
