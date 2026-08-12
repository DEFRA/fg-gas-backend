import { AgreementLifecycle } from "../agreement-lifecycle.js";

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
      }),
      commitOperations: processResult.commitOperations,
    };
  };
};
