import Boom from "@hapi/boom";
import { AgreementIdentityAllocation } from "./agreement-identity-allocation.js";
import { AgreementIdentityType } from "./agreement-identity-type.js";

const duplicateReference = (workflow, reference) =>
  Boom.badImplementation(
    `Agreement ${workflow} produced duplicate candidate reference "${reference}"`,
  );

const unknownReference = (workflow, reference) =>
  Boom.badImplementation(
    `Agreement ${workflow} produced unknown candidate reference "${reference}"`,
  );

const recordCandidateReference = (candidate, id, references, workflow) => {
  if (candidate.ref === undefined) {
    return;
  }

  if (references.has(candidate.ref)) {
    throw duplicateReference(workflow, candidate.ref);
  }

  references.set(candidate.ref, id);
};

const withMaterialisedIdentity = (candidate, id) => {
  const value = structuredClone(candidate);
  delete value.ref;

  return { ...value, id };
};

const materialiseEntries = (entries, resolveIdentity, workflow) => {
  const references = new Map();
  const values = entries.map((entry) => {
    const id = resolveIdentity(entry);
    recordCandidateReference(entry, id, references, workflow);
    return withMaterialisedIdentity(entry, id);
  });

  return { references, values };
};

const materialiseCreationEntries = (candidate, type) => {
  const allocation = AgreementIdentityAllocation.forCreation(type);

  return materialiseEntries(
    candidate[type.field],
    () => allocation.allocate(),
    "creation",
  );
};

const reconcileTransitionEntries = (agreement, candidate, type) => {
  const allocation = AgreementIdentityAllocation.forTransition(agreement, type);
  const materialised = materialiseEntries(
    candidate[type.field],
    (entry) => allocation.resolve(entry),
    "transition",
  );

  return {
    ...materialised,
    ids: new Set(materialised.values.map(({ id }) => id)),
  };
};

const findCandidateReference = (lineItem) =>
  AgreementIdentityType.funded.find(({ candidateReference }) =>
    Object.hasOwn(lineItem, candidateReference),
  );

const findPersistedReference = (lineItem) =>
  AgreementIdentityType.funded.find(({ persistedReference }) =>
    Object.hasOwn(lineItem, persistedReference),
  );

const replaceCandidateReference = (
  lineItem,
  reference,
  reconciled,
  workflow,
) => {
  const candidateReference = lineItem[reference.candidateReference];
  const id = reconciled[reference.field].references.get(candidateReference);

  if (!id) {
    throw unknownReference(workflow, candidateReference);
  }

  const value = structuredClone(lineItem);
  delete value[reference.candidateReference];

  return { ...value, [reference.persistedReference]: id };
};

const resolveCreationLineItem = (lineItem, materialised) => {
  const reference = findCandidateReference(lineItem);

  if (!reference) {
    throw unknownReference("creation", undefined);
  }

  return replaceCandidateReference(
    lineItem,
    reference,
    materialised,
    "creation",
  );
};

const requireSurvivingReference = (lineItem, reference, reconciled) => {
  const id = lineItem[reference.persistedReference];

  if (!reconciled[reference.field].ids.has(id)) {
    throw Boom.badImplementation(
      `Agreement transition produced unknown persisted reference "${id}"`,
    );
  }

  return structuredClone(lineItem);
};

const resolveTransitionLineItem = (lineItem, reconciled) => {
  const candidateReference = findCandidateReference(lineItem);

  if (candidateReference) {
    return replaceCandidateReference(
      lineItem,
      candidateReference,
      reconciled,
      "transition",
    );
  }

  const persistedReference = findPersistedReference(lineItem);
  return requireSurvivingReference(lineItem, persistedReference, reconciled);
};

const entryValues = (entriesByType) =>
  Object.fromEntries(
    AgreementIdentityType.funded.map(({ field }) => [
      field,
      entriesByType[field].values,
    ]),
  );

const materialisePaymentSchedule = (
  paymentSchedule,
  resolveInstalmentIdentity,
  entries,
  resolveLineItem,
) => {
  if (!paymentSchedule) {
    return undefined;
  }

  return {
    ...paymentSchedule,
    instalments: paymentSchedule.instalments.map((instalment) => ({
      ...instalment,
      id: resolveInstalmentIdentity(instalment),
      lineItems: instalment.lineItems.map((lineItem) =>
        resolveLineItem(lineItem, entries),
      ),
    })),
  };
};

export const materialiseCreationIdentities = (candidate) => {
  const materialised = Object.fromEntries(
    AgreementIdentityType.funded.map((type) => [
      type.field,
      materialiseCreationEntries(candidate, type),
    ]),
  );
  const instalmentAllocation = AgreementIdentityAllocation.forCreation(
    AgreementIdentityType.instalments,
  );

  return {
    ...candidate,
    ...entryValues(materialised),
    paymentSchedule: materialisePaymentSchedule(
      candidate.paymentSchedule,
      () => instalmentAllocation.allocate(),
      materialised,
      resolveCreationLineItem,
    ),
  };
};

export const reconcileTransitionIdentities = (agreement, candidate) => {
  const reconciled = Object.fromEntries(
    AgreementIdentityType.funded.map((type) => [
      type.field,
      reconcileTransitionEntries(agreement, candidate, type),
    ]),
  );
  const instalmentAllocation = AgreementIdentityAllocation.forTransition(
    agreement,
    AgreementIdentityType.instalments,
  );

  return {
    ...candidate,
    ...entryValues(reconciled),
    paymentSchedule: materialisePaymentSchedule(
      candidate.paymentSchedule,
      (instalment) => instalmentAllocation.resolve(instalment),
      reconciled,
      resolveTransitionLineItem,
    ),
  };
};
