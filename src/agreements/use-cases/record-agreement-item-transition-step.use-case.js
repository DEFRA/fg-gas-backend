import { resolveActionMap } from "./agreement-action-paths.js";
import { recordAgreementItemTransition } from "./record-agreement-item-transition.use-case.js";

const resolveItemPatch = ({ context, effect }) =>
  resolveActionMap({
    map: effect.params,
    root: context,
  });

export const recordAgreementItemTransitionStep = async ({
  context,
  effect,
}) => {
  const { createId, item, previousVersion } = context;
  const status = effect.target;
  const version = await recordAgreementItemTransition(
    {
      agreementItemId: item.agreementItemId,
      changedAt: context.executedAt,
      createId,
      fromStatus: effect.fromStatus,
      itemPatch: resolveItemPatch({ context, effect }),
      previousVersion,
      toStatus: status,
    },
    context.session,
  );

  return { status, version };
};
