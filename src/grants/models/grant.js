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
    return this.phases && this.phases.length > 0;
  }

  getPhase(phaseCode) {
    return phaseCode
      ? this.phases.find((p) => p.code === phaseCode)
      : this.phases[0];
  }

  getQuestions(phaseCode) {
    if (!this.hasPhases) {
      return {};
    }
    const phase = this.getPhase(phaseCode);

    return phase?.questions || {};
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
