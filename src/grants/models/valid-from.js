export class ValidFrom {
  constructor({ code, processes }) {
    this.code = code;
    this.processes = processes;
  }

  // A fully qualified code matches the whole position, any other code the
  // status alone, in any stage of any phase.
  get matchedBy() {
    return this.code.includes(":") ? "position" : "status";
  }

  matches(position) {
    if (this.matchedBy === "position") {
      return this.code === position;
    }

    return this.code === position.split(":").pop();
  }
}
