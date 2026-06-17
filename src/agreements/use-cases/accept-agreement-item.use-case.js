import Boom from "@hapi/boom";
import { randomUUID } from "node:crypto";
import { config } from "../../common/config.js";
import { Outbox } from "../../grants/models/outbox.js";
import { insertMany } from "../../grants/repositories/outbox.repository.js";
import { CreatePaymentClaimCommand } from "../events/create-payment-claim.command.js";
import { getAgreementDefinition } from "../models/agreement-definition.js";
import { AgreementVersion } from "../models/agreement-version.js";
import {
  findAgreementByItemId,
  findLatestAgreementVersion,
  insertAgreementVersion,
} from "../repositories/agreement.repository.js";

const statuses = {
  OFFERED: "offered",
  ACCEPTANCE_PENDING: "acceptancePending",
};

const defaultDependencies = {
  createId: randomUUID,
  now: () => new Date().toISOString(),
};

const resolveDependencies = (dependencies) => ({
  ...defaultDependencies,
  ...dependencies,
});

const assertConfiguredAction = ({ definition, actionName }) => {
  if (definition.lifecycle.actions?.[actionName]) {
    return;
  }

  throw Boom.badRequest(
    `Agreement definition ${definition.agreementCode} has no action named "${actionName}"`,
  );
};

const assertOffered = (itemState) => {
  if (itemState?.status === statuses.OFFERED) {
    return;
  }

  throw Boom.badRequest("Agreement item is not offered");
};

const createPaymentOutboxRecord = ({ agreement, item, version }) => {
  const event = new CreatePaymentClaimCommand({ agreement, item, version });

  return new Outbox({
    event,
    target: config.sns.createAgreementTopicArn,
    segregationRef: Outbox.getSegregationRef(event),
  });
};

const findAgreementItem = async (agreementItemId, session) => {
  const agreement = await findAgreementByItemId(agreementItemId, session);

  if (!agreement) {
    throw Boom.notFound("Agreement item not found");
  }

  const item = agreement.items.find(
    (candidate) => candidate.agreementItemId === agreementItemId,
  );

  if (!item) {
    throw Boom.notFound("Agreement item not found");
  }

  return { agreement, item };
};

export const acceptAgreementItem = async (
  command,
  session,
  dependencies = {},
) => {
  const { createId, now } = resolveDependencies(dependencies);
  const acceptedAt = now();
  const { agreement, item } = await findAgreementItem(
    command.agreementItemId,
    session,
  );

  const definition = getAgreementDefinition(item.agreementCode);
  assertConfiguredAction({ definition, actionName: command.actionName });

  const previousVersion = await findLatestAgreementVersion(
    agreement.id,
    session,
  );
  const previousItemState = previousVersion.findItemState(item.agreementItemId);
  assertOffered(previousItemState);

  const version = AgreementVersion.transition({
    id: createId(),
    previousVersion,
    agreementItemId: item.agreementItemId,
    status: statuses.ACCEPTANCE_PENDING,
    createdAt: acceptedAt,
    change: {
      type: statuses.ACCEPTANCE_PENDING,
      changedBy: command.acceptedBy,
      fromStatus: statuses.OFFERED,
    },
    itemPatch: {
      acceptedAt,
      acceptedBy: command.acceptedBy,
    },
  });

  await insertAgreementVersion(version, session);
  await insertMany(
    [createPaymentOutboxRecord({ agreement, item, version })],
    session,
  );

  return {
    agreementId: agreement.id,
    agreementItemId: item.agreementItemId,
    agreementNumber: agreement.agreementNumber,
    status: statuses.ACCEPTANCE_PENDING,
    version,
  };
};
