import Boom from "@hapi/boom";
import { ExternalStatusMapping } from "./external-status-mapping.js";
import { Position } from "./position.js";

export class ExternalStatusMap {
  constructor(externalStatusMap) {
    this.mappings = (externalStatusMap?.phases ?? []).flatMap((phase) =>
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
    const scopeOf = ({ phase, stage, source, code }) =>
      JSON.stringify([phase, stage, source, code]);
    const siblings = this.mappings.filter(
      (other) => scopeOf(other) === scopeOf(mapping),
    );
    const overlaps = siblings.some(
      (other) =>
        other !== mapping &&
        (other.fromStatus === undefined ||
          other.fromStatus === mapping.fromStatus),
    );
    if (overlaps) {
      throw Boom.badImplementation(
        `Ambiguous ${mapping.source} status "${mapping.code}" mapping at "${from}"`,
      );
    }
  }
}
