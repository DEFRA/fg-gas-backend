import Boom from "@hapi/boom";
import { grantDefinition } from "../schemas/grant/grant-definition.js";
import { storedLifecycle } from "../schemas/grant/stored-lifecycle.js";
import { EntitlementTemplate } from "./entitlement-template.js";
import { ExternalStatusMap } from "./external-status-map.js";
import { ExternalStatusMapping } from "./external-status-mapping.js";
import { GrantLifecycle } from "./grant-lifecycle.js";
import { Position } from "./position.js";
import { ValidFrom } from "./valid-from.js";

const formatPosition = ({ phase, stage, status }) =>
  [phase, stage, status].filter((part) => part != null).join(":");

const codeAndName = ({ code, name }) => ({ code, name: name ?? null });

const positionParts = ["phase", "stage", "status"];
const isNonEmptyString = (value) =>
  typeof value === "string" && value.trim().length > 0;

export class Grant {
  static definitionSchema = grantDefinition;

  constructor({
    code,
    version,
    metadata,
    actions,
    phases,
    externalStatusMap,
    amendablePositions = [],
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
    this.entitlementTemplates = entitlementTemplates.map(
      (template) => new EntitlementTemplate(template),
    );
    this.pages = pages;
    this.claims = claims;
    this.admin = admin;

    this.#assertEntitlementTemplateClaimCodesUnique();
    this.#assertEntitlementTemplatePositionsExist();
    this.#assertClaimApprovalPositionsExist();
  }

  // Builds a Grant from a published grant definition, so a definition can be checked
  // before its version is recorded. Only a published definition is built into a
  // GrantLifecycle and an ExternalStatusMap, and so held to their rules: a stored
  // grant goes through the constructor alone and has to load as it is.
  static fromDefinition(definition, version, dependencies) {
    Grant.#assertMatchesDefinitionSchema(definition);

    const grant = new Grant({ ...definition, version });
    grant.#assertPublishable(dependencies);

    return grant;
  }

  static #assertMatchesDefinitionSchema(definition) {
    const { error } = Grant.definitionSchema.validate(definition, {
      abortEarly: false,
    });

    if (error) {
      throw Boom.badImplementation(
        `Invalid grant definition "${definition?.code}": ${error.details.map((d) => d.message).join(", ")}`,
      );
    }
  }

  #assertPublishable(dependencies) {
    try {
      const lifecycle = new GrantLifecycle(this.phases, dependencies);

      new ExternalStatusMap(this.externalStatusMap).assertTargetsExistIn(
        lifecycle,
      );
      this.#assertAmendablePositionsExistIn(lifecycle);
    } catch (error) {
      if (!error.isBoom) {
        throw error;
      }

      throw Boom.badImplementation(`Grant "${this.code}" ${error.message}`);
    }
  }

  // Application.isReplacementAllowed matches the whole position exactly.
  #assertAmendablePositionsExistIn(lifecycle) {
    for (const position of this.amendablePositions) {
      if (!lifecycle.has(Position.parse(position))) {
        throw Boom.badImplementation(
          `amendable position "${position}" does not match any position in "phases"`,
        );
      }
    }
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

    return this.#isSamePosition(currentPosition, position)
      ? targetPosition
      : null;
  }

  #isSamePosition(a, b) {
    return a.phase === b.phase && a.stage === b.stage && a.status === b.status;
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
        `Entitlement template "${claimCode}" is ${relation} position "${formatPosition(position)}" which does not match any position in "phases"`,
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
    const current = formatPosition(currentPosition);
    const target = formatPosition(targetPosition);
    if (current === target) {
      return;
    }

    const transition = this.isValidTransition(
      targetPosition.phase,
      targetPosition.stage,
      targetPosition.status,
      current,
    );
    if (!transition.valid) {
      throw Boom.badImplementation(
        `Grant "${this.code}" claims.onClaimApproval target position "${target}" is not a valid transition from "${current}"`,
      );
    }
  }

  #assertClaimApprovalPositionComplete(label, position) {
    for (const part of positionParts) {
      if (!isNonEmptyString(position?.[part])) {
        throw Boom.badImplementation(
          `Grant "${this.code}" claims.onClaimApproval.${label}.${part} must be a non-empty string`,
        );
      }
    }
  }

  #assertClaimApprovalPositionExists(label, position) {
    this.#assertClaimApprovalPositionComplete(label, position);

    if (!this.#positionExists(position)) {
      throw Boom.badImplementation(
        `Grant "${this.code}" claims.onClaimApproval.${label} "${formatPosition(position)}" does not match any position in "phases"`,
      );
    }
  }

  // Only the parts the template declares are checked: a phase-only position is
  // valid as long as the phase exists.
  #positionExists({ phase, stage, status }) {
    const foundPhase = this.#findPhase(this.phases, phase);
    const foundStage = this.#findStage(foundPhase, stage);
    const foundStatus = this.#findStatus(foundStage, status);

    if (status != null) {
      return Boolean(foundStatus);
    }

    if (stage != null) {
      return Boolean(foundStage);
    }

    return Boolean(foundPhase);
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
    const { target } = new ExternalStatusMapping(
      { mappedTo },
      { phase: currentPhase, stage: currentStage },
    );

    if (!target) {
      return { valid: false };
    }

    return {
      valid: true,
      targetPhase: target.phase,
      targetStage: target.stage,
      targetStatus: target.status,
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

    if (this.#isFromAnyStatus(statusDef)) {
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

  #isFromAnyStatus(statusDef) {
    return !statusDef.validFrom || statusDef.validFrom.length === 0;
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
    return validFrom.find((entry) =>
      new ValidFrom(entry).matches(currentStatus),
    );
  }

  // What can happen to an application of this grant, decided by the same
  // lookups that move one. A stored grant is described as it loads, held only
  // to the shape those lookups read, not to the rules a newly published
  // definition is held to.
  describeLifecycle() {
    this.#assertDescribable();
    const positions = this.#distinctPositions();

    return {
      phases: this.#describePhases(),
      initialPosition: this.#initialPosition(),
      amendablePositions: [...this.amendablePositions],
      waysIn: positions.flatMap((to) => this.#waysInto(to, positions)),
      externalMappings: this.#appliedExternalStatusMappings(),
      claimApproval: this.#claimApproval(),
    };
  }

  #assertDescribable() {
    const { error } = storedLifecycle.validate(
      { phases: this.phases, externalStatusMap: this.externalStatusMap },
      { abortEarly: false },
    );

    if (error) {
      throw Boom.badImplementation(
        `Grant "${this.code}" has a lifecycle GAS cannot read: ${error.details.map((d) => d.message).join(", ")}`,
      );
    }
  }

  #describePhases() {
    return this.phases.map((phase) => ({
      ...codeAndName(phase),
      stages: phase.stages.map((stage) => ({
        ...codeAndName(stage),
        statuses: stage.statuses.map(codeAndName),
      })),
    }));
  }

  #distinctPositions() {
    const positions = this.phases.flatMap((phase) =>
      phase.stages.flatMap((stage) =>
        stage.statuses.map(
          (status) =>
            new Position({
              phase: phase.code,
              stage: stage.code,
              status: status.code,
            }),
        ),
      ),
    );

    return [
      ...new Map(
        positions.map((position) => [position.toString(), position]),
      ).values(),
    ];
  }

  #initialPosition() {
    const { phase, stage, status } = this.getInitialState();

    return new Position({
      phase: phase.code,
      stage: stage.code,
      status: status.code,
    }).toString();
  }

  // A status the lookup never reaches, under a repeated phase or stage code,
  // has no way in.
  #waysInto(to, positions) {
    const statusDef = this.findStatusDefinition(to.phase, to.stage, to.status);

    if (!statusDef) {
      return [];
    }

    if (this.#isFromAnyStatus(statusDef)) {
      return [
        {
          to: to.toString(),
          kind: "any",
          processes: statusDef.processes ?? [],
        },
      ];
    }

    return statusDef.validFrom.flatMap((entry) =>
      this.#waysIntoBy(entry, statusDef.validFrom, to, positions),
    );
  }

  // Each source moves by the first entry it matches. An entry that matches
  // only the status itself, or only sources taken by earlier entries, is never
  // used.
  #waysIntoBy(entry, validFrom, to, positions) {
    const target = to.toString();
    const { processes } = entry;
    const entryValidFrom = new ValidFrom(entry);
    const { matchedBy } = entryValidFrom;
    const moves = positions
      .map((from) => from.toString())
      .filter(
        (from) =>
          from !== target && this.#isValidFromMatch(validFrom, from) === entry,
      )
      .map((from) => ({
        to: target,
        kind: "move",
        from,
        matchedBy,
        processes,
      }));

    if (moves.length > 0 || this.#matchesAnyOf(entryValidFrom, positions)) {
      return moves;
    }

    return [
      { to: target, kind: "unmatched", code: entry.code, matchedBy, processes },
    ];
  }

  #matchesAnyOf(validFrom, positions) {
    return positions.some((position) => validFrom.matches(position.toString()));
  }

  // Only the mapping the lookup finds for its source and code while in its
  // phase and stage is ever applied.
  #appliedExternalStatusMappings() {
    return new ExternalStatusMap(this.externalStatusMap).mappings
      .filter(
        (mapping) =>
          this.#findExternalStatusMapping(
            mapping.phase,
            mapping.stage,
            mapping.code,
            mapping.source,
          ) === mapping.entry,
      )
      .map((mapping) => mapping.describe());
  }

  #claimApproval() {
    const transition = this.claims?.onClaimApproval;

    if (!transition) {
      return null;
    }

    return {
      from: formatPosition(transition.currentPosition),
      to: formatPosition(transition.targetPosition),
    };
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
