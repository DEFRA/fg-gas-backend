import Boom from "@hapi/boom";
import { ExternalStatusMapping } from "./external-status-mapping.js";
import { Position } from "./position.js";

export class ExternalStatusMap {
  constructor(externalStatusMap) {
    this.phases = externalStatusMap?.phases ?? [];
  }

  // Lookup must also tolerate stored maps that have not passed publish validation.
  get mappings() {
    return this.phases.flatMap((phase) =>
      phase.stages.flatMap((stage) =>
        stage.statuses.map(
          (status) =>
            new ExternalStatusMapping(status, {
              phase: phase.code,
              stage: stage.code,
            }),
        ),
      ),
    );
  }

  find({ phase, stage, code, source, status }) {
    const candidates = this.#statusesIn(phase, stage);
    const matches = candidates.filter(
      (entry) =>
        entry.code === code &&
        entry.source === source &&
        (entry.fromStatus === undefined || entry.fromStatus === status),
    );
    this.#assertUnambiguous(matches, { phase, stage, code, source, status });
    const [mapping = {}] = matches;
    return mapping.mappedTo ? mapping : null;
  }

  #statusesIn(phase, stage) {
    return this.#findStage(phase, stage)?.statuses ?? [];
  }

  #findStage(phase, stage) {
    const definition = this.phases.find((entry) => entry.code === phase);
    return definition?.stages?.find((entry) => entry.code === stage);
  }

  #assertUnambiguous(matches, { phase, stage, code, source, status }) {
    if (
      matches.length > 1 &&
      matches.some((entry) => entry.fromStatus !== undefined)
    ) {
      throw Boom.badImplementation(
        `Ambiguous ${source} status "${code}" mapping at "${phase}:${stage}:${status}"`,
      );
    }
  }

  assertTargetsExistIn(lifecycle) {
    for (const mapping of this.mappings) {
      this.#assertFromStatus(mapping, lifecycle);
      if (!lifecycle.has(mapping.target)) {
        throw Boom.badImplementation(
          `${mapping.source} status "${mapping.code}" at "${mapping.phase}:${mapping.stage}" is mapped to "${mapping.mappedTo}" which does not match any position in "phases"`,
        );
      }
    }
  }

  #assertFromStatus(mapping, lifecycle) {
    if (mapping.fromStatus === undefined) {
      return;
    }
    const from = new Position({
      phase: mapping.phase,
      stage: mapping.stage,
      status: mapping.fromStatus,
    });
    if (!lifecycle.has(from)) {
      throw Boom.badImplementation(
        `${mapping.source} status "${mapping.code}" has fromStatus "${mapping.fromStatus}" which does not match a position in "${mapping.phase}:${mapping.stage}"`,
      );
    }
    this.find({ ...mapping, status: mapping.fromStatus });
  }
}
