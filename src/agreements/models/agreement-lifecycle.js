import { InvalidAgreementTransitionError } from "./invalid-agreement-transition.error.js";

export const defaultAgreementLifecycle = {
  create: { target: "offered" },
  states: {
    offered: {
      on: {
        accept: { target: "accepted" },
        withdraw: { target: "withdrawn" },
        cancel: { target: "cancelled" },
      },
    },
    accepted: {
      on: {
        terminate: { target: "terminated" },
      },
    },
    withdrawn: {},
    cancelled: {},
    terminated: {},
  },
};

export class AgreementLifecycle {
  constructor(definition = defaultAgreementLifecycle) {
    this.definition = definition;
  }

  getInitialState() {
    return this.definition.create.target;
  }

  getAvailableActions(state) {
    const stateDefinition = this.definition.states[state];
    if (!stateDefinition) {
      throw new Error(`Unknown agreement lifecycle state: "${state}"`);
    }
    return Object.keys(stateDefinition.on ?? {});
  }

  resolveAction(state, action) {
    const availableActions = this.getAvailableActions(state);
    const transition = this.definition.states[state].on?.[action];

    if (!transition) {
      throw new InvalidAgreementTransitionError({
        from: state,
        action,
        availableActions,
      });
    }

    return { from: state, action, target: transition.target };
  }
}
