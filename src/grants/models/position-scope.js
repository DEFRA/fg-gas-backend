import { Position } from "./position.js";

export class PositionScope {
  constructor(props) {
    this.phase = props.phase;
    this.stage = props.stage;
    this.status = props.status;
  }

  static areAll(scopes) {
    return (scopes ?? []).every((scope) => scope instanceof PositionScope);
  }

  static anyCovers(scopes, position) {
    return Boolean(position) && scopes.some((scope) => scope.covers(position));
  }

  toString() {
    return new Position(this).toString();
  }

  covers(position) {
    return (
      this.phase === position.phase &&
      this.#partCovers(this.stage, position.stage) &&
      this.#partCovers(this.status, position.status)
    );
  }

  #partCovers(declared, actual) {
    return declared == null || declared === actual;
  }
}
