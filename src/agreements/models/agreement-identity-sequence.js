import { AgreementIdentityType } from "./agreement-identity-type.js";

const recordedOrdinal = (identitySequence, namespace) => {
  const ordinal = identitySequence?.[namespace];
  return Number.isSafeInteger(ordinal) && ordinal > 0 ? ordinal : 0;
};

const currentOrdinal = (values, type) =>
  Math.max(0, ...type.entriesOf(values).map(({ id }) => type.ordinalOf(id)));

export const resolveAgreementIdentitySequence = (values) =>
  Object.fromEntries(
    AgreementIdentityType.all.map((type) => [
      type.namespace,
      Math.max(
        recordedOrdinal(values.identitySequence, type.namespace),
        currentOrdinal(values, type),
      ),
    ]),
  );
