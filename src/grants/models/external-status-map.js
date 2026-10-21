import Boom from "@hapi/boom";
import { ExternalStatusMapping } from "./external-status-mapping.js";

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
      if (!lifecycle.has(mapping.target)) {
        throw Boom.badImplementation(
          `${mapping.source} status "${mapping.code}" at "${mapping.phase}:${mapping.stage}" is mapped to "${mapping.mappedTo}" which does not match any position in "phases"`,
        );
      }
    }
  }
}
