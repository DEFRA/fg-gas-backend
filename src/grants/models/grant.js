export class Grant {
  constructor({ code, metadata, actions, phases }) {
    this.code = code;
    this.metadata = {
      description: metadata.description,
      startDate: metadata.startDate,
    };
    this.actions = actions;
    this.phases = phases;
  }

  get hasPhases() {
    return Boolean(this.phases && this.phases.length > 0);
  }

  getInitialState() {
    if (!this.hasPhases) {
      throw new Error(`Grant "${this.code}" has no phases defined`);
    }

    const [phase] = this.phases;
    const [stage] = phase.stages;
    const [status] = stage.statuses;

    return {
      phase,
      stage,
      status,
    };
  }
}
