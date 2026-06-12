export class AgreementVersion {
  constructor(document) {
    this.document = document;
    this.id = document._id;
    this.agreementId = document.agreementId;
    this.agreementNumber = document.agreementNumber;
    this.sbi = document.sbi;
    this.version = document.version;
    this.createdAt = document.createdAt;
    this.change = document.change;
    this.snapshot = document.snapshot;
  }

  static initial({ id, agreement, definition, createdAt }) {
    return new AgreementVersion({
      _id: id,
      agreementId: agreement.id,
      agreementNumber: agreement.agreementNumber,
      sbi: agreement.sbi,
      version: 1,
      createdAt,
      change: {
        type: definition.lifecycle.initialChangeType,
        changedBy: definition.lifecycle.changedBy,
        fromStatus: definition.lifecycle.fromStatus,
      },
      snapshot: createAgreementSnapshot({
        agreement,
        initialStatus: definition.lifecycle.initialStatus,
      }),
    });
  }

  findItemState(agreementItemId) {
    return this.snapshot.items.find(
      (itemSnapshot) => itemSnapshot.agreementItemId === agreementItemId,
    );
  }

  toDocument() {
    return this.document;
  }
}

const createItemSnapshot = ({ item, initialStatus }) => ({
  ...item.toDocument(),
  status: initialStatus,
  payment: null,
});

const createAgreementSnapshot = ({ agreement, initialStatus }) => {
  const { items, ...agreementSnapshot } = structuredClone(
    agreement.toDocument(),
  );

  return {
    ...agreementSnapshot,
    items: agreement.items.map((item) =>
      createItemSnapshot({ item, initialStatus }),
    ),
  };
};
