import { auditActions, auditEntities } from "../../events/audit-constants.js";
import { buildAuditEvent, withAudit } from "../../events/with-audit.js";
import { withTransaction } from "../../common/with-transaction.js";
import { ClaimableEntitlement } from "../models/claimable-entitlement.js";
import { Entitlement, InvalidEntitlementData } from "../models/entitlement.js";
import { countByEntitlement } from "../repositories/claim.repository.js";
import {
  findExistingEntitlements,
  updateEntitlementData,
} from "../repositories/entitlement.repository.js";
import {
  pinnedVersionOf,
  resolveCurrentGrantUseCase,
} from "../use-cases/resolve-current-grant.use-case.js";
import {
  lockApplication,
  mapApplicationNotFound,
} from "./entitlement-application.js";
import {
  configurationChanged,
  entitlementClaimed,
  entitlementNotFound,
  invalidClaimCode,
  invalidUpdateData,
} from "./entitlement-errors.js";
import { toChangedValues } from "./entitlement-audit-values.js";
import { toEntitlementDto } from "./map-entitlement.js";

const templateForUpdate = ({ command, grant, entitlement }) => {
  const template = grant.findEntitlementTemplate(entitlement.claimCode);

  if (!template) {
    throw invalidClaimCode({
      ...command,
      claimCode: entitlement.claimCode,
      grant,
    });
  }

  return template;
};

const entitlementToUpdate = ({ command, existing }) => {
  const document = existing.find((each) => each.id === command.entitlementId);

  if (!document) {
    throw entitlementNotFound(command);
  }

  return Entitlement.fromDocument(document);
};

// Claim submission takes the same application lock before it counts, so a
// Claim cannot land between this count and the write.
const refuseOnceClaimed = async ({ command, claimable }, session) => {
  const claimCount = await countByEntitlement(
    {
      code: command.code,
      clientRef: command.clientRef,
      entitlementId: command.entitlementId,
    },
    session,
  );

  if (!claimable.canBeChanged(claimCount)) {
    throw entitlementClaimed(claimable);
  }
};

const changeEntitlement = ({ command, entitlement, template }) => {
  try {
    return entitlement.withInputData(template, command.data);
  } catch (error) {
    if (error instanceof InvalidEntitlementData) {
      throw invalidUpdateData({
        template,
        data: command.data,
        claimCode: template.claimCode,
      });
    }

    throw error;
  }
};

const writeEntitlementUpdate = async ({ entitlement }, session) => {
  await updateEntitlementData(entitlement, session);

  return entitlement;
};

const updateAuditDataBuilder = (args, entitlement) => {
  if (!entitlement) {
    return null;
  }

  const { code, clientRef, actor, template, previous } = args[0];

  return buildAuditEvent({
    entity: auditEntities.ENTITLEMENT,
    action: auditActions.UPDATE,
    entityid: entitlement.id,
    details: {
      code,
      clientRef,
      claimCode: entitlement.claimCode,
      actor: actor ?? null,
      ...toChangedValues(template, previous, entitlement),
    },
  });
};

const writeEntitlementUpdateWithAudit = withAudit(
  writeEntitlementUpdate,
  updateAuditDataBuilder,
);

const updateInTransaction = async (
  { command, grant, pinnedVersion },
  session,
) => {
  const application = await lockApplication(command, session);

  if (pinnedVersionOf(application) !== pinnedVersion) {
    throw configurationChanged(command);
  }

  const existing = await findExistingEntitlements(
    command.clientRef,
    command.code,
    session,
  );
  const entitlement = entitlementToUpdate({ command, existing });
  const template = templateForUpdate({ command, grant, entitlement });
  const claimable = ClaimableEntitlement.fromPersisted({
    entitlement,
    template,
  });

  await refuseOnceClaimed({ command, claimable }, session);

  const updated = await writeEntitlementUpdateWithAudit(
    {
      ...command,
      template,
      previous: entitlement,
      entitlement: changeEntitlement({ command, entitlement, template }),
    },
    session,
  );

  return toEntitlementDto(updated);
};

export const updateEntitlement = async (command) => {
  const application = await mapApplicationNotFound(command);
  const pinnedVersion = pinnedVersionOf(application);
  const { grant } = await resolveCurrentGrantUseCase(
    command.code,
    pinnedVersion,
  );

  return withTransaction((session) =>
    updateInTransaction({ command, grant, pinnedVersion }, session),
  );
};
