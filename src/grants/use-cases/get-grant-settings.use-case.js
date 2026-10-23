import {
  PMC_0706_SECURITY,
  auditActions,
  auditEntities,
} from "../../events/audit-constants.js";
import { auditedRead } from "../../events/audited-read.js";
import { buildAuditEvent } from "../../events/with-audit.js";
import { GrantSettings } from "../models/grant-settings.js";
import { findByGrantCode } from "../repositories/grant-settings.repository.js";
import { resolveGrantAdministration } from "./resolve-grant-administration.use-case.js";

export const getGrantSettingsUseCase = auditedRead(
  async (args) => {
    await resolveGrantAdministration(args);
    const settings =
      (await findByGrantCode(args.grantCode)) ??
      GrantSettings.closed(args.grantCode);
    return settings.toDocument();
  },
  ({ grantCode, caller }, result) =>
    buildAuditEvent({
      entity: auditEntities.GRANT,
      action: auditActions.VIEW_GRANT_SETTINGS,
      entityid: grantCode,
      details: { caller, ...(result && { settings: result }) },
      security: PMC_0706_SECURITY,
    }),
);
