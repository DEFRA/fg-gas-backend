import { AgreementItem } from "../models/agreement-item.js";
import { resolveEffectParams } from "../services/effects/resolve-effect-params.js";

export const applyItemSnapshotEffect = async (context, { params = {} }) => {
  const snapshotPatch = await resolveEffectParams(params, context);
  const item = new AgreementItem(context.item).applySnapshotPatch(
    snapshotPatch,
  );

  return { context: { item } };
};
