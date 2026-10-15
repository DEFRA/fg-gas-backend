const isNonEmptyString = (value) =>
  typeof value === "string" && value.trim().length > 0;

export class Position {
  static #separator = ":";
  static #parts = ["phase", "stage", "status"];

  constructor(props) {
    this.phase = props.phase;
    this.stage = props.stage;
    this.status = props.status;
  }

  static parse(code) {
    const [phase, stage, ...rest] = code.split(Position.#separator);
    const status = rest.length > 0 ? rest.join(Position.#separator) : undefined;

    return new Position({ phase, stage, status });
  }

  static #isFullyQualified(code) {
    return code.split(Position.#separator).length === Position.#parts.length;
  }

  withStatus(status) {
    return new Position({ phase: this.phase, stage: this.stage, status });
  }

  // "PHASE:STAGE:STATUS" names a position outright; "::STATUS" and "STATUS"
  // change the status and keep the phase and stage.
  resolve(code) {
    if (code.startsWith("::")) {
      return this.withStatus(code.substring(2));
    }

    if (!code.includes(Position.#separator)) {
      return this.withStatus(code);
    }

    return Position.#isFullyQualified(code) ? Position.parse(code) : null;
  }

  toString() {
    return [this.phase, this.stage, this.status]
      .filter((part) => part != null)
      .join(Position.#separator);
  }

  equals(position) {
    return (
      this.phase === position.phase &&
      this.stage === position.stage &&
      this.status === position.status
    );
  }

  hasSameCode(position) {
    return this.toString() === String(position);
  }

  incompletePart() {
    return Position.#parts.find((part) => !isNonEmptyString(this[part]));
  }

  // A code with a separator is a whole position; a bare one is a status.
  matchesCode(code) {
    return code.includes(Position.#separator)
      ? code === this.toString()
      : code === this.status;
  }
}
