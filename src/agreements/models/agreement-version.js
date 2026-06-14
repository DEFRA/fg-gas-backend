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

  static initial({ id, agreement, initialVersion, createdAt }) {
    return new AgreementVersion({
      _id: id,
      agreementId: agreement.id,
      agreementNumber: agreement.agreementNumber,
      sbi: agreement.sbi,
      version: 1,
      createdAt,
      change: {
        type: initialVersion.changeType,
        changedBy: initialVersion.changedBy,
        fromStatus: initialVersion.fromStatus,
      },
      snapshot: createAgreementSnapshot({
        agreement,
        initialStatus: initialVersion.initialStatus,
      }),
    });
  }

  static transition({
    id,
    previousVersion,
    agreementItemId,
    status,
    change,
    createdAt,
    itemPatch = {},
  }) {
    const snapshot = structuredClone(previousVersion.snapshot);
    const itemState = snapshot.items.find(
      (item) => item.agreementItemId === agreementItemId,
    );

    itemState.status = status;
    Object.assign(itemState, itemPatch);
    snapshot.updatedAt = createdAt;

    return new AgreementVersion({
      _id: id,
      agreementId: previousVersion.agreementId,
      agreementNumber: previousVersion.agreementNumber,
      sbi: previousVersion.sbi,
      version: previousVersion.version + 1,
      createdAt,
      change,
      snapshot,
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
