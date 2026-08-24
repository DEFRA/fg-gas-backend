import { buildClaimsView } from "../services/build-claims-view.js";
import { resolveEntitlementsUseCase } from "./resolve-entitlements.use-case.js";

export const findClaimsUseCase = async ({ code, clientRef }) => {
  const { application, grant, available } = await resolveEntitlementsUseCase({
    code,
    clientRef,
  });

  return buildClaimsView({ grant, application, available });
};
