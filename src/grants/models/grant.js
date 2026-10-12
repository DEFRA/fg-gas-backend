import Boom from "@hapi/boom";
import { EntitlementTemplate } from "./entitlement-template.js";
import { Position } from "./position.js";

const toEntitlementTemplates = (entitlementTemplates = []) =>
  entitlementTemplates.map((template) =>
    EntitlementTemplate.fromDefinition(template),
  );

const toPosition = (position) => new Position(position ?? {});

const toAmendablePosition = (code) =>
  typeof code === "string" ? Position.parse(code) : code;

const toAmendablePositions = (codes) =>
  Array.isArray(codes) ? codes.map(toAmendablePosition) : codes;

const withClaimApprovalPositions = (claims) => {
  const config = claims?.onClaimApproval;
  if (!config) {
    return claims;
  }

  return {
    ...claims,
    onClaimApproval: {
      ...config,
      currentPosition: toPosition(config.currentPosition),
      targetPosition: toPosition(config.targetPosition),
    },
  };
};

export class Grant {
  constructor({
    code,
    version,
    metadata,
    actions,
    phases,
    externalStatusMap,
    amendablePositions,
    // Always a collection, never absent. The repository normalises what it
    // reads out of Mongo; everything else builds a Grant from a request or a
    // grant definition, where omitting the block means it has none.
    entitlementTemplates = [],
    // How a page built from this grant labels and fills its banner. Absent for
    // a grant no admin page is configured for, which is every grant until one
    // is written.
    pages,
    claims,
    admin,
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
    this.entitlementTemplates = entitlementTemplates;
    this.pages = pages;
    this.claims = claims;
    this.admin = admin;

    this.#assertEntitlementTemplateClaimCodesUnique();
    this.#assertEntitlementTemplatePositionsExist();
    this.#assertClaimApprovalPositionsExist();
  }

  // Builds a Grant from a published grant definition, so a definition can be checked
  // without saving it.
  static fromDefinition(grantDefinition, version) {
    return new Grant({
      ...grantDefinition,
      version,
      amendablePositions: toAmendablePositions(
        grantDefinition?.amendablePositions,
      ),
      entitlementTemplates: toEntitlementTemplates(
        grantDefinition?.entitlementTemplates,
      ),
      claims: withClaimApprovalPositions(grantDefinition?.claims),
    });
  }

  findEntitlementTemplate(claimCode) {
    return this.entitlementTemplates.find(
      (template) => template.claimCode === claimCode,
    );
  }

  // Every template that could yield an entitlement once an application reaches
  // the given position. Materialised or not is the caller's business: both
  // kinds are gated on position alone.
  findEntitlementTemplatesAvailableAt(position) {
    return this.entitlementTemplates.filter((template) =>
      template.isAvailableAt(position),
    );
  }

  claimApprovalTransitionFor(position) {
    const config = this.claims?.onClaimApproval;
    if (!config) {
      return null;
    }

    const { currentPosition, targetPosition } = config;

    return position.equals(currentPosition) ? targetPosition : null;
  }

  // findEntitlementTemplate returns the first match, so a duplicated claim code
  // would silently half-ignore one of the definitions. The array Joi schema
  // enforces this for the admin API; the S3 ingest path builds each template
  // individually, so the aggregate has to enforce it too.
  #assertEntitlementTemplateClaimCodesUnique() {
    const claimCodes = new Set();

    for (const template of this.entitlementTemplates) {
      if (claimCodes.has(template.claimCode)) {
        throw Boom.badImplementation(
          `Duplicate entitlement template claim code "${template.claimCode}"`,
        );
      }

      claimCodes.add(template.claimCode);
    }
  }

  // A position that resolves to nothing disables the template silently - it
  // simply never becomes available - which is how this ticket's own missing
  // PHASE_CLAIM gap went unnoticed. Reject it at ingest instead.
  #assertEntitlementTemplatePositionsExist() {
    for (const template of this.entitlementTemplates) {
      this.#assertTemplatePositionsExist(template);
    }
  }

  #assertTemplatePositionsExist(template) {
    this.#assertPositionsExist(
      template.claimCode,
      "available at",
      template.availableAt,
    );
    this.#assertPositionsExist(
      template.claimCode,
      "claimable at",
      this.#claimableAtPositions(template),
    );
  }

  #claimableAtPositions(template) {
    return template.claim?.claimableAt ?? [];
  }

  #assertPositionsExist(claimCode, relation, positions) {
    for (const position of positions) {
      this.#assertPositionExists(claimCode, relation, position);
    }
  }

  #assertPositionExists(claimCode, relation, position) {
    if (!this.#positionExists(position)) {
      throw Boom.badImplementation(
        `Entitlement template "${claimCode}" is ${relation} position "${position}" which does not match any position in "phases"`,
      );
    }
  }

  #assertClaimApprovalPositionsExist() {
    const config = this.claims?.onClaimApproval;
    if (!config) {
      return;
    }

    this.#assertClaimApprovalPositionExists(
      "currentPosition",
      config.currentPosition,
    );
    this.#assertClaimApprovalPositionExists(
      "targetPosition",
      config.targetPosition,
    );
    this.#assertClaimApprovalTransitionValid(config);
  }

  #assertClaimApprovalTransitionValid({ currentPosition, targetPosition }) {
    if (currentPosition.equals(targetPosition)) {
      return;
    }

    const transition = this.isValidTransition(targetPosition, currentPosition);
    if (!transition.valid) {
      throw Boom.badImplementation(
        `Grant "${this.code}" claims.onClaimApproval target position "${targetPosition}" is not a valid transition from "${currentPosition}"`,
      );
    }
  }

  #assertClaimApprovalPositionComplete(label, position) {
    const part = position.incompletePart();

    if (part) {
      throw Boom.badImplementation(
        `Grant "${this.code}" claims.onClaimApproval.${label}.${part} must be a non-empty string`,
      );
    }
  }

  #assertClaimApprovalPositionIsPosition(label, position) {
    if (!(position instanceof Position)) {
      throw Boom.badImplementation(
        `Grant "${this.code}" claims.onClaimApproval.${label} must be a Position`,
      );
    }
  }

  #assertClaimApprovalPositionExists(label, position) {
    this.#assertClaimApprovalPositionIsPosition(label, position);
    this.#assertClaimApprovalPositionComplete(label, position);

    if (!this.#positionExists(position)) {
      throw Boom.badImplementation(
        `Grant "${this.code}" claims.onClaimApproval.${label} "${position}" does not match any position in "phases"`,
      );
    }
  }

  // Only the parts the template declares are checked: a phase-only position is
  // valid as long as the phase exists.
  #positionExists(position) {
    if (position.status != null) {
      return Boolean(this.findStatusDefinition(position));
    }

    if (position.stage != null) {
      return Boolean(this.#findStage(this.phases, position));
    }

    return Boolean(this.#findPhase(this.phases, position));
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

  getInitialPosition() {
    const { phase, stage, status } = this.getInitialState();

    return new Position({
      phase: phase.code,
      stage: stage.code,
      status: status.code,
    });
  }

  // Helper methods to navigate the hierarchy
  #findPhase(phases, position) {
    return phases?.find((p) => p.code === position.phase);
  }

  #findStage(phases, position) {
    return this.#findPhase(phases, position)?.stages?.find(
      (s) => s.code === position.stage,
    );
  }

  mapExternalStateToInternalState(
    currentPosition,
    externalRequestedState,
    sourceSystem,
  ) {
    const statusMapping = this.#findExternalStatusMapping(
      currentPosition,
      externalRequestedState,
      sourceSystem,
    );

    if (!statusMapping) {
      return { valid: false };
    }

    const targetPosition = currentPosition.resolve(statusMapping.mappedTo);

    return targetPosition ? { valid: true, targetPosition } : { valid: false };
  }

  #matchesExternalStatus(status, externalRequestedState, sourceSystem) {
    return (
      status.code === externalRequestedState && status.source === sourceSystem
    );
  }

  hasExternalStatusMapping(currentPosition, externalRequestedState, source) {
    return this.#findExternalStatusMapping(
      currentPosition,
      externalRequestedState,
      source,
    );
  }

  // eslint-disable-next-line complexity
  #findExternalStatusMapping(
    currentPosition,
    externalRequestedState,
    sourceSystem,
  ) {
    const stageMap = this.#findStage(
      this.externalStatusMap?.phases,
      currentPosition,
    );

    const statusMapping = stageMap?.statuses?.find((status) =>
      this.#matchesExternalStatus(status, externalRequestedState, sourceSystem),
    );

    if (!statusMapping?.mappedTo) {
      return null;
    }

    return statusMapping;
  }

  // eslint-disable-next-line complexity
  isValidTransition(targetPosition, currentPosition) {
    const statusDef = this.findStatusDefinition(targetPosition);

    if (!statusDef) {
      return { valid: false, processes: [] };
    }

    if (!statusDef.validFrom || statusDef.validFrom.length === 0) {
      return {
        valid: true,
        processes: statusDef.processes || [],
      };
    }

    const isValid = this.#isValidFromMatch(
      statusDef.validFrom,
      currentPosition,
    );

    return {
      valid: !!isValid,
      processes: isValid?.processes,
    };
  }

  findStatusDefinition(position) {
    return this.#findStage(this.phases, position)?.statuses?.find(
      (s) => s.code === position.status,
    );
  }

  #isValidFromMatch(validFrom, currentPosition) {
    return validFrom.find((entry) => currentPosition.matchesCode(entry.code));
  }

  findStatuses(position) {
    const stage = this.#findStage(this.phases, position);

    const statuses = stage?.statuses || [];

    // Convert array to object map for easier lookup
    const statusMap = {};
    statuses.forEach((status) => {
      statusMap[status.code] = status;
    });

    return statusMap;
  }
}
