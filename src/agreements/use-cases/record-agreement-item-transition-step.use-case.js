import { resolveActionMap } from "./agreement-action-paths.js";
import { recordAgreementItemTransition } from "./record-agreement-item-transition.use-case.js";

const getResolutionRoot = ({ context }) => ({
  ...context,
  action: context.actionState,
});

const resolveItemPatch = ({ context, step }) =>
  resolveActionMap({
    map: step.itemPatch,
    root: getResolutionRoot({ context }),
  });

export const recordAgreementItemTransitionStep = async ({ context, step }) => {
  const { command, createId, item, previousVersion } = context;
  const status = step.toStatus;
  const version = await recordAgreementItemTransition(
    {
      agreementItemId: item.agreementItemId,
      changedAt: context.executedAt,
      changedBy: step.changedBy ?? command.acceptedBy,
      changeType: step.changeType,
      createId,
      fromStatus: step.fromStatus,
      itemPatch: resolveItemPatch({ context, step }),
      previousVersion,
      toStatus: status,
    },
    context.session,
  );

  return { status, version };
};
