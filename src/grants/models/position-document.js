export class PositionDocument {
  constructor(position) {
    this.phase = position.phase;

    if (position.stage != null) {
      this.stage = position.stage;
    }

    if (position.status != null) {
      this.status = position.status;
    }
  }
}
