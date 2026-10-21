import Boom from "@hapi/boom";
import { Stage } from "./stage.js";
import { assertUniqueCodes } from "./unique-codes.js";

export class Phase {
  constructor(
    { code, stages, questions },
    { isKnownProcess, compileQuestions },
  ) {
    assertUniqueCodes(stages, (stageCode) => `stage "${code}:${stageCode}"`);

    this.code = code;
    this.stages = stages.map(
      (stage) => new Stage(stage, { phaseCode: code, isKnownProcess }),
    );
    this.questions = questions;

    this.#assertQuestionsCompile(compileQuestions);
  }

  get hasQuestions() {
    return Boolean(this.questions);
  }

  #assertQuestionsCompile(compileQuestions) {
    if (!this.hasQuestions) {
      return;
    }

    try {
      compileQuestions(this.questions);
    } catch (error) {
      throw Boom.badImplementation(
        `phase "${this.code}" questions cannot be compiled: ${error.message}`,
      );
    }
  }
}
