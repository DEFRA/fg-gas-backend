import Boom from "@hapi/boom";
import { ValidFrom } from "./valid-from.js";

export class Status {
  constructor(
    { code, validFrom = [], processes },
    { position, isKnownProcess },
  ) {
    this.code = code;
    this.position = position;
    this.validFrom = validFrom.map((entry) => new ValidFrom(entry));
    this.#assertOwnProcessesRun(processes);
    this.processesOnEntering = this.#processesOnEntering(processes);

    this.#assertProcessesKnown(isKnownProcess);
  }

  assertValidFromResolvesIn(positions) {
    for (const entry of this.validFrom) {
      this.#assertValidFromResolves(entry, positions);
    }
  }

  #assertValidFromResolves(entry, positions) {
    if (!positions.some((position) => entry.matches(position.toString()))) {
      throw Boom.badImplementation(
        `status "${this.position}" is valid from "${entry.code}" which does not match any position in "phases"`,
      );
    }
  }

  // A status's own processes run only when it has no validFrom.
  #assertOwnProcessesRun(processes) {
    if (this.validFrom.length > 0 && processes?.length > 0) {
      throw Boom.badImplementation(
        `status "${this.position}" has its own processes, which would never run because it has validFrom`,
      );
    }
  }

  #processesOnEntering(processes) {
    if (this.validFrom.length > 0) {
      return this.validFrom.flatMap((entry) => entry.processes);
    }

    return this.#ownProcesses(processes);
  }

  // A transition skips a single string, so it is not checked.
  #ownProcesses(processes) {
    if (processes == null || typeof processes === "string") {
      return [];
    }

    if (!Array.isArray(processes)) {
      throw Boom.badImplementation(
        `status "${this.position}" has processes that are not a list`,
      );
    }

    return processes;
  }

  #assertProcessesKnown(isKnownProcess) {
    const unknown = this.processesOnEntering.find(
      (process) => !isKnownProcess(process),
    );

    if (unknown !== undefined) {
      throw Boom.badImplementation(
        `status "${this.position}" runs unknown process "${unknown}"`,
      );
    }
  }
}
