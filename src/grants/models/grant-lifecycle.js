import Boom from "@hapi/boom";
import { Phase } from "./phase.js";
import { assertUniqueCodes } from "./unique-codes.js";

// The phases of a published grant definition, held to the rules a definition
// has to meet before its version is recorded.
export class GrantLifecycle {
  constructor(phases, { isKnownProcess, compileQuestions }) {
    assertUniqueCodes(phases, (code) => `phase "${code}"`);

    this.phases = phases.map(
      (phase) => new Phase(phase, { isKnownProcess, compileQuestions }),
    );

    this.#assertInitialPhaseHasQuestions();
    this.#assertValidFromResolves();
  }

  get statuses() {
    return this.phases.flatMap((phase) =>
      phase.stages.flatMap((stage) => stage.statuses),
    );
  }

  get positions() {
    return this.statuses.map((status) => status.position);
  }

  has(position) {
    return this.positions.some((candidate) => candidate.equals(position));
  }

  // Every application's answers are validated against the first phase's
  // questions.
  #assertInitialPhaseHasQuestions() {
    const [initialPhase] = this.phases;

    if (!initialPhase.hasQuestions) {
      throw Boom.badImplementation(
        `phase "${initialPhase.code}" has no questions to validate answers against`,
      );
    }
  }

  #assertValidFromResolves() {
    const { positions } = this;

    for (const status of this.statuses) {
      status.assertValidFromResolvesIn(positions);
    }
  }
}
