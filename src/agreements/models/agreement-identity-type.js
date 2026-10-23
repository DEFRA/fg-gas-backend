const fieldEntries = (field) => ({
  field,
  entries: (values) => values[field] ?? [],
  currentEntries: (agreement) => agreement[field],
});

export class AgreementIdentityType {
  #pattern;
  #entries;
  #currentEntries;

  constructor({
    namespace,
    field,
    label,
    candidateReference,
    persistedReference,
    entries,
    currentEntries = entries,
  }) {
    this.namespace = namespace;
    this.field = field;
    this.label = label;
    this.candidateReference = candidateReference;
    this.persistedReference = persistedReference;
    this.#entries = entries;
    this.#currentEntries = currentEntries;
    this.#pattern = new RegExp(String.raw`^${namespace}:([1-9]\d*)$`);
  }

  idFor(ordinal) {
    return `${this.namespace}:${ordinal}`;
  }

  ordinalOf(id) {
    const match = id?.match(this.#pattern);
    return match ? Number(match[1]) : 0;
  }

  entriesOf(values) {
    return this.#entries(values);
  }

  currentEntriesOf(agreement) {
    return this.#currentEntries(agreement);
  }

  static actions = Object.freeze(
    new AgreementIdentityType({
      namespace: "action",
      label: "Revenue Action",
      candidateReference: "actionRef",
      persistedReference: "actionId",
      ...fieldEntries("actions"),
    }),
  );

  static items = Object.freeze(
    new AgreementIdentityType({
      namespace: "item",
      label: "Capital Item",
      candidateReference: "itemRef",
      persistedReference: "itemId",
      ...fieldEntries("items"),
    }),
  );

  static instalments = Object.freeze(
    new AgreementIdentityType({
      namespace: "instalment",
      label: "Payment Schedule Instalment",
      entries: ({ paymentSchedule }) => paymentSchedule?.instalments ?? [],
    }),
  );

  static funded = Object.freeze([
    AgreementIdentityType.actions,
    AgreementIdentityType.items,
  ]);

  static all = Object.freeze([
    AgreementIdentityType.actions,
    AgreementIdentityType.items,
    AgreementIdentityType.instalments,
  ]);
}
