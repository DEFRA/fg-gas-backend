import Boom from "@hapi/boom";
import { AgreementLifecycle } from "../agreement-lifecycle.js";

// Creation and page Processes stage no Commit Operations at all; an Action
// stages at most one, so a single transaction never commits two.
const assertSingleCommitOperation = (commitOperations) => {
  if (commitOperations.length > 1) {
    throw Boom.badImplementation(
      "Agreement Action Processes staged more than one commit operation",
    );
  }

  return commitOperations;
};

export const compileAgreementActionExecution = (
  definition,
  { runProcesses },
) => {
  const lifecycle = new AgreementLifecycle(definition);

  return async ({ agreement, actionName, values, execution }) => {
    const action = lifecycle.resolveAction(agreement.state, actionName);
    const processResult = await runProcesses({
      location: {
        type: "transition",
        state: agreement.state,
        transition: actionName,
      },
      context: {
        agreement,
        transition: { values },
        execution,
      },
    });

    return {
      agreement: agreement.transition({
        target: action.transition.target,
        transitionedAt: execution.executedAt,
        values: processResult.agreementValues,
        configVersion:
          action.transition.target === "accepted"
            ? definition.configVersion
            : undefined,
      }),
      commitOperations: assertSingleCommitOperation(
        processResult.commitOperations,
      ),
    };
  };
};
