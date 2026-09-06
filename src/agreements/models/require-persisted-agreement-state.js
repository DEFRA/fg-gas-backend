import Boom from "@hapi/boom";

export const requirePersistedAgreementState = ({ definition, state }) => {
  const stateDefinition = definition.states[state];

  if (!stateDefinition) {
    throw Boom.badImplementation(
      definition.code
        ? `Agreement code "${definition.code}" has unknown persisted state "${state}"`
        : `Agreement lifecycle has unknown persisted state "${state}"`,
    );
  }

  return stateDefinition;
};
