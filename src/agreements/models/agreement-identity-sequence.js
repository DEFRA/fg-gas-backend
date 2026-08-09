const identityOrdinal = (id, namespace) => {
  const match = id?.match(new RegExp(`^${namespace}:([1-9]\\d*)$`));
  return match ? Number(match[1]) : 0;
};

const identityEntries = {
  action: ({ actions }) => actions ?? [],
  item: ({ items }) => items ?? [],
  instalment: ({ paymentSchedule }) => paymentSchedule?.instalments ?? [],
};

const recordedOrdinal = (identitySequence, namespace) => {
  const ordinal = identitySequence?.[namespace];
  return Number.isSafeInteger(ordinal) && ordinal > 0 ? ordinal : 0;
};

const currentOrdinal = (values, namespace) =>
  Math.max(
    0,
    ...identityEntries[namespace](values).map(({ id }) =>
      identityOrdinal(id, namespace),
    ),
  );

export const resolveAgreementIdentitySequence = (values) =>
  Object.fromEntries(
    Object.keys(identityEntries).map((namespace) => [
      namespace,
      Math.max(
        recordedOrdinal(values.identitySequence, namespace),
        currentOrdinal(values, namespace),
      ),
    ]),
  );

export const nextAgreementIdentityOrdinal = (agreement, namespace) =>
  resolveAgreementIdentitySequence(agreement)[namespace] + 1;
