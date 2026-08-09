import Boom from "@hapi/boom";

const identityTypes = Object.freeze({
  actions: {
    field: "actions",
    namespace: "action",
    label: "Revenue Action",
    candidateReference: "actionRef",
    persistedReference: "actionId",
  },
  items: {
    field: "items",
    namespace: "item",
    label: "Capital Item",
    candidateReference: "itemRef",
    persistedReference: "itemId",
  },
  instalments: {
    field: "instalments",
    namespace: "instalment",
    label: "Payment Schedule Instalment",
  },
});

const fundedIdentityTypes = [identityTypes.actions, identityTypes.items];

const identityOrdinal = (id, namespace) => {
  const match = id?.match(new RegExp(`^${namespace}:([1-9]\\d*)$`));
  return match ? Number(match[1]) : 0;
};

const nextOrdinal = (entries, namespace) =>
  Math.max(0, ...entries.map(({ id }) => identityOrdinal(id, namespace))) + 1;

const allocateIdentity = (allocation) => {
  const id = `${allocation.type.namespace}:${allocation.nextOrdinal}`;
  allocation.nextOrdinal += 1;
  return id;
};

const requireExistingIdentity = (id, allocation) => {
  if (!allocation.existingIds.has(id)) {
    throw Boom.badImplementation(
      `Agreement transition cannot select unknown stable ${allocation.type.label} identity "${id}"`,
    );
  }

  return id;
};

const resolveTransitionIdentity = (candidate, allocation) =>
  candidate.id
    ? requireExistingIdentity(candidate.id, allocation)
    : allocateIdentity(allocation);

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

const materialiseCreationEntries = (candidate, type) => {
  const allocation = { type, nextOrdinal: 1 };
  const references = new Map();
  const values = candidate[type.field].map((entry) => {
    const id = allocateIdentity(allocation);
    recordCandidateReference(entry, id, references, "creation");
    return withMaterialisedIdentity(entry, id);
  });

  return { references, values };
};

const createTransitionAllocation = (entries, type) => ({
  existingIds: new Set(entries.map(({ id }) => id)),
  nextOrdinal: nextOrdinal(entries, type.namespace),
  type,
});

const reconcileTransitionEntries = (agreement, candidate, type) => {
  const allocation = createTransitionAllocation(agreement[type.field], type);
  const references = new Map();
  const values = candidate[type.field].map((entry) => {
    const id = resolveTransitionIdentity(entry, allocation);
    recordCandidateReference(entry, id, references, "transition");
    return withMaterialisedIdentity(entry, id);
  });

  return {
    ids: new Set(values.map(({ id }) => id)),
    references,
    values,
  };
};

const findCandidateReference = (lineItem) =>
  fundedIdentityTypes.find(({ candidateReference }) =>
    Object.hasOwn(lineItem, candidateReference),
  );

const findPersistedReference = (lineItem) =>
  fundedIdentityTypes.find(({ persistedReference }) =>
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
    fundedIdentityTypes.map(({ field }) => [
      field,
      entriesByType[field].values,
    ]),
  );

const materialisePaymentSchedule = (
  paymentSchedule,
  allocation,
  entries,
  resolveLineItem,
) => {
  if (!paymentSchedule) {
    return undefined;
  }

  const { field } = allocation.type;

  return {
    ...paymentSchedule,
    [field]: paymentSchedule[field].map((instalment) => ({
      ...instalment,
      id: allocation.resolveIdentity(instalment, allocation),
      lineItems: instalment.lineItems.map((lineItem) =>
        resolveLineItem(lineItem, entries),
      ),
    })),
  };
};

export const materialiseCreationIdentities = (candidate) => {
  const materialised = Object.fromEntries(
    fundedIdentityTypes.map((type) => [
      type.field,
      materialiseCreationEntries(candidate, type),
    ]),
  );
  const instalments = {
    nextOrdinal: 1,
    resolveIdentity: (_candidate, allocation) => allocateIdentity(allocation),
    type: identityTypes.instalments,
  };

  return {
    ...candidate,
    ...entryValues(materialised),
    paymentSchedule: materialisePaymentSchedule(
      candidate.paymentSchedule,
      instalments,
      materialised,
      resolveCreationLineItem,
    ),
  };
};

export const reconcileTransitionIdentities = (agreement, candidate) => {
  const reconciled = Object.fromEntries(
    fundedIdentityTypes.map((type) => [
      type.field,
      reconcileTransitionEntries(agreement, candidate, type),
    ]),
  );
  const instalmentType = identityTypes.instalments;
  const currentInstalments =
    agreement.paymentSchedule?.[instalmentType.field] ?? [];
  const instalments = {
    ...createTransitionAllocation(currentInstalments, instalmentType),
    resolveIdentity: resolveTransitionIdentity,
  };

  return {
    ...candidate,
    ...entryValues(reconciled),
    paymentSchedule: materialisePaymentSchedule(
      candidate.paymentSchedule,
      instalments,
      reconciled,
      resolveTransitionLineItem,
    ),
  };
};
