import Boom from "@hapi/boom";
import { withTransaction } from "../../common/with-transaction.js";
import {
  PMC_0706_SECURITY,
  auditActions,
  auditEntities,
} from "../../events/audit-constants.js";
import { buildAuditEvent, withAudit } from "../../events/with-audit.js";
import { DbReferenceData } from "../models/db-reference-data.js";
import {
  findByGrantCodeAndName,
  replace,
} from "../repositories/reference-data.repository.js";
import { resolveAndFetchGrant } from "../services/resolve-config-version.service.js";
import { findReferenceDataDeclaration } from "./get-reference-data.use-case.js";
import { resolveGrantAdministration } from "./resolve-grant-administration.use-case.js";

// Only a set the grant's current version declares as db can be changed here;
// an inline or endpoint set has no items GAS holds.
const assertHeldInDb = async ({ grantCode, name, ...access }) => {
  await resolveGrantAdministration({ grantCode, ...access });
  const { grant } = await resolveAndFetchGrant(grantCode);
  const declaration = findReferenceDataDeclaration(grant, name);

  if (!declaration.isHeldInDb) {
    throw Boom.conflict(
      `Reference data "${name}" comes from ${declaration.type}, so its items cannot be changed in GAS`,
    );
  }
};

const load = async (grantCode, name, session) =>
  (await findByGrantCodeAndName(grantCode, name, session)) ??
  DbReferenceData.empty(grantCode, name);

const changes = {
  add: (referenceData, { item }) => referenceData.addItem(item),
  change: (referenceData, { itemCode, item }) =>
    referenceData.changeItem(itemCode, item),
  remove: (referenceData, { itemCode }) => referenceData.removeItem(itemCode),
};

// An add names its item in the payload; a change or removal in the path.
const changedCodeOf = ({ itemCode, item }) => itemCode ?? item?.code;

const toJSONOrNull = (item) => (item ? item.toJSON() : null);

const applyChange = async (args, session) => {
  const referenceData = await load(args.grantCode, args.name, session);
  const previous = referenceData.find(changedCodeOf(args));

  changes[args.change](referenceData, args);
  await replace(referenceData, session);

  return {
    representation: referenceData.toJSON(),
    previous: toJSONOrNull(previous),
  };
};

const failureDetails = (error) => ({
  errorCode: error.output?.statusCode ?? "UNEXPECTED_FAILURE",
});

const successDetails = ({ item }, { previous }) => ({
  oldItem: previous,
  newItem: item ?? null,
});

const buildChangeAudit = ([args], result, error) =>
  buildAuditEvent({
    entity: auditEntities.GRANT,
    action: auditActions.CHANGE_REFERENCE_DATA,
    entityid: args.grantCode,
    details: {
      caller: args.caller,
      name: args.name,
      change: args.change,
      ...(error ? failureDetails(error) : successDetails(args, result)),
    },
    security: PMC_0706_SECURITY,
  });

const applyChangeWithAudit = withAudit(applyChange, buildChangeAudit);

const changeDbReferenceData = async (args) => {
  await assertHeldInDb(args);

  const result = await withTransaction((session) =>
    applyChangeWithAudit(args, session),
  );

  return result.representation;
};

export const addDbReferenceDataItemUseCase = (args) =>
  changeDbReferenceData({ ...args, change: "add" });

export const changeDbReferenceDataItemUseCase = (args) =>
  changeDbReferenceData({ ...args, change: "change" });

export const removeDbReferenceDataItemUseCase = (args) =>
  changeDbReferenceData({ ...args, change: "remove" });
