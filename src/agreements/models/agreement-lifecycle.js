import Boom from "@hapi/boom";
import { AgreementAction } from "./agreement-action.js";
import { InvalidAgreementTransitionError } from "./invalid-agreement-transition.error.js";
import { requirePersistedAgreementState } from "./require-persisted-agreement-state.js";

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
    const stateDefinition = requirePersistedAgreementState({
      definition: this.definition,
      state,
    });

    return Object.keys(stateDefinition.on ?? {});
  }

  resolveActionForTarget(state, target) {
    const stateDefinition = requirePersistedAgreementState({
      definition: this.definition,
      state,
    });
    const transitions = stateDefinition.on ?? {};
    const matches = Object.keys(transitions).filter(
      (action) => transitions[action].target === target,
    );

    if (matches.length === 0) {
      throw new InvalidAgreementTransitionError({
        from: state,
        action: `transition to ${target}`,
        availableActions: Object.keys(transitions),
      });
    }
    if (matches.length > 1) {
      throw Boom.badImplementation(
        `Agreement state "${state}" configures multiple actions targeting "${target}"`,
      );
    }

    return this.resolveAction(state, matches[0]);
  }

  resolveAction(state, actionName) {
    const stateDefinition = requirePersistedAgreementState({
      definition: this.definition,
      state,
    });
    const transitions = stateDefinition.on ?? {};
    const availableActions = Object.keys(transitions);

    if (!Object.hasOwn(transitions, actionName)) {
      throw new InvalidAgreementTransitionError({
        from: state,
        action: actionName,
        availableActions,
      });
    }

    const { page, target, validation } = transitions[actionName];

    return new AgreementAction({
      from: state,
      name: actionName,
      page,
      target,
      validation,
    });
  }
}
