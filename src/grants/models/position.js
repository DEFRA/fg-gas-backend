const FULLY_QUALIFIED_PARTS = 3;

export class Position {
  constructor({ phase, stage, status }) {
    this.phase = phase;
    this.stage = stage;
    this.status = status;
  }

  // Null for anything that is not written PHASE:STAGE:STATUS.
  static parse(value) {
    const parts = value.split(":");

    if (parts.length !== FULLY_QUALIFIED_PARTS) {
      return null;
    }

    const [phase, stage, status] = parts;

    return new Position({ phase, stage, status });
  }

  equals(other) {
    return (
      this.phase === other?.phase &&
      this.stage === other.stage &&
      this.status === other.status
    );
  }

  toString() {
    return `${this.phase}:${this.stage}:${this.status}`;
  }
}
