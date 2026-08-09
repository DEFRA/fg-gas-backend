import Boom from "@hapi/boom";
import { nextAgreementIdentityOrdinal } from "../agreement-identity-sequence.js";

const requireExistingIdentity = (id, allocation) => {
  if (!allocation.existingIds.has(id)) {
    throw Boom.badImplementation(
      `Agreement transition cannot select unknown stable ${allocation.label} identity "${id}"`,
    );
  }

  return id;
};

const resolveEntryIdentity = (candidate, allocation) => {
  if (candidate.id) {
    return requireExistingIdentity(candidate.id, allocation);
  }

  const id = `${allocation.namespace}:${allocation.nextOrdinal}`;
  allocation.nextOrdinal += 1;
  return id;
};

const recordCandidateReference = (candidate, id, references) => {
  if (candidate.ref === undefined) {
    return;
  }

  if (references.has(candidate.ref)) {
    throw Boom.badImplementation(
      `Agreement transition produced duplicate candidate reference "${candidate.ref}"`,
    );
  }

  references.set(candidate.ref, id);
};

const createAllocation = (agreement, entries, namespace, label) => ({
  existingIds: new Set(entries.map(({ id }) => id)),
  label,
  namespace,
  nextOrdinal: nextAgreementIdentityOrdinal(agreement, namespace),
});

const reconcileEntries = (agreement, candidates, namespace, label) => {
  const currentEntries =
    agreement[namespace === "action" ? "actions" : "items"];
  const allocation = createAllocation(
    agreement,
    currentEntries,
    namespace,
    label,
  );
  const references = new Map();
  const values = candidates.map((candidate) => {
    const id = resolveEntryIdentity(candidate, allocation);
    recordCandidateReference(candidate, id, references);
    const value = structuredClone(candidate);
    delete value.ref;

    return { ...value, id };
  });

  return { references, values };
};

const candidateReferenceFields = [
  { candidateField: "actionRef", persistedField: "actionId", type: "actions" },
  { candidateField: "itemRef", persistedField: "itemId", type: "items" },
];

const findCandidateReference = (lineItem) =>
  candidateReferenceFields.find(({ candidateField }) =>
    Object.hasOwn(lineItem, candidateField),
  );

const resolveCandidateLineItem = (lineItem, reconciled) => {
  const reference = findCandidateReference(lineItem);

  if (!reference) {
    return structuredClone(lineItem);
  }

  const candidateReference = lineItem[reference.candidateField];
  const id = reconciled[reference.type].references.get(candidateReference);
  if (!id) {
    throw Boom.badImplementation(
      `Agreement transition produced unknown candidate reference "${candidateReference}"`,
    );
  }

  const value = structuredClone(lineItem);
  delete value[reference.candidateField];

  return { ...value, [reference.persistedField]: id };
};

const reconcileInstalment = (instalment, allocation, reconciled) => ({
  ...instalment,
  id: resolveEntryIdentity(instalment, allocation),
  lineItems: instalment.lineItems.map((lineItem) =>
    resolveCandidateLineItem(lineItem, reconciled),
  ),
});

const reconcilePaymentSchedule = (agreement, candidate, reconciled) => {
  if (!candidate) {
    return undefined;
  }

  const currentInstalments = agreement.paymentSchedule?.instalments ?? [];
  const allocation = createAllocation(
    agreement,
    currentInstalments,
    "instalment",
    "Payment Schedule Instalment",
  );

  return {
    ...candidate,
    instalments: candidate.instalments.map((instalment) =>
      reconcileInstalment(instalment, allocation, reconciled),
    ),
  };
};

export const reconcileTransitionIdentities = (agreement, candidate) => {
  const reconciled = {
    actions: reconcileEntries(
      agreement,
      candidate.actions,
      "action",
      "Revenue Action",
    ),
    items: reconcileEntries(agreement, candidate.items, "item", "Capital Item"),
  };

  return {
    ...candidate,
    actions: reconciled.actions.values,
    items: reconciled.items.values,
    paymentSchedule: reconcilePaymentSchedule(
      agreement,
      candidate.paymentSchedule,
      reconciled,
    ),
  };
};
