import { Position } from "./position.js";

export class ExternalStatusMapping {
  constructor(entry, { phase, stage }) {
    const { code, source, mappedTo } = entry;

    this.entry = entry;
    this.code = code;
    this.source = source;
    this.mappedTo = mappedTo;
    this.phase = phase;
    this.stage = stage;
  }

  // "::STATUS" and "STATUS" stay in the mapping's stage, "PHASE:STAGE:STATUS"
  // names its own, and anything else is never valid.
  get target() {
    if (this.mappedTo.startsWith("::")) {
      return this.#inStage(this.mappedTo.substring(2));
    }

    if (this.mappedTo.includes(":")) {
      return Position.parse(this.mappedTo);
    }

    return this.#inStage(this.mappedTo);
  }

  describe() {
    return {
      source: this.source,
      code: this.code,
      whileIn: `${this.phase}:${this.stage}`,
      mappedTo: this.mappedTo,
      to: this.target?.toString() ?? null,
    };
  }

  #inStage(status) {
    return new Position({ phase: this.phase, stage: this.stage, status });
  }
}
