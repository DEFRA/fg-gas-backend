import Boom from "@hapi/boom";
import { withTransaction } from "../../common/with-transaction.js";
import {
  PMC_0706_SECURITY,
  auditActions,
  auditEntities,
} from "../../events/audit-constants.js";
import { buildAuditEvent, withAudit } from "../../events/with-audit.js";
import { GrantSettings } from "../models/grant-settings.js";
import {
  findByGrantCode,
  save,
} from "../repositories/grant-settings.repository.js";
import { resolveGrantAdministration } from "./resolve-grant-administration.use-case.js";

const errorCodes = { 403: "GRANT_ADMIN_ACCESS_DENIED", 404: "GRANT_NOT_FOUND" };
const errorCodeOf = (error) => {
  if (!Boom.isBoom(error)) return "UNEXPECTED_FAILURE";
  const { payload, statusCode } = error.output;
  return payload.errorCode === "GRANT_SETTINGS_VALIDATION_FAILED"
    ? payload.errorCode
    : (errorCodes[statusCode] ?? "UNEXPECTED_FAILURE");
};

const buildSaveAudit = ([{ grantCode, caller }], result, error) =>
  buildAuditEvent({
    entity: auditEntities.GRANT,
    action: auditActions.SAVE_GRANT_SETTINGS,
    entityid: grantCode,
    details: {
      caller,
      ...(error
        ? {
            errorCode: errorCodeOf(error),
          }
        : { oldSettings: result.previous, newSettings: result.representation }),
    },
    security: PMC_0706_SECURITY,
  });

const resolveWithAudit = withAudit(
  resolveGrantAdministration,
  (args, result, error) => (error ? buildSaveAudit(args, result, error) : null),
);
const saveWithAudit = withAudit(async ({ grantCode, open }, session) => {
  const settings =
    (await findByGrantCode(grantCode, session)) ??
    GrantSettings.closed(grantCode);
  const previous = settings.toDocument();
  settings.setOpen(open);
  await save(settings, session);
  return { previous, representation: settings.toDocument() };
}, buildSaveAudit);

export const saveGrantSettingsUseCase = async (args) => {
  await resolveWithAudit(args);
  const result = await withTransaction((session) =>
    saveWithAudit(args, session),
  );
  return result.representation;
};
