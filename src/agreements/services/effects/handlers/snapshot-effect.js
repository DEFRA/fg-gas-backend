import { resolveEffectParams } from "../resolve-effect-params.js";

export const snapshotEffect = async (context, { params = {} }) => {
  const snapshotPatch = await resolveEffectParams(params, context);
  const item = context.item.applySnapshotPatch(snapshotPatch);

  return { context: { item } };
};
