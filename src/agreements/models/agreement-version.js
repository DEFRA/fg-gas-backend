export class AgreementVersion {
  constructor(document) {
    this.document = document;
    this.id = document._id;
    this.agreementId = document.agreementId;
    this.agreementNumber = document.agreementNumber;
    this.version = document.version;
    this.createdAt = document.createdAt;
    this.snapshot = document.snapshot;
  }

  static initial({ id, agreement, initialStatus, createdAt, itemPatch = {} }) {
    return new AgreementVersion({
      _id: id,
      agreementId: agreement.id,
      agreementNumber: agreement.agreementNumber,
      version: 1,
      createdAt,
      snapshot: createAgreementSnapshot({
        agreement,
        initialStatus,
        itemPatch,
      }),
    });
  }

  static transition({
    id,
    previousVersion,
    agreementItemId,
    status,
    createdAt,
    itemPatch = {},
  }) {
    const snapshot = structuredClone(previousVersion.snapshot);
    const itemState = snapshot.items.find(
      (item) => item.agreementItemId === agreementItemId,
    );

    delete snapshot.sbi;
    itemState.status = status;
    Object.assign(itemState, itemPatch);
    snapshot.updatedAt = createdAt;

    return new AgreementVersion({
      _id: id,
      agreementId: previousVersion.agreementId,
      agreementNumber: previousVersion.agreementNumber,
      version: previousVersion.version + 1,
      createdAt,
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

const createItemSnapshot = ({ item, initialStatus, itemPatch }) => ({
  ...item.toSnapshotDocument(),
  status: initialStatus,
  payment: null,
  ...itemPatch,
});

const createAgreementSnapshot = ({ agreement, initialStatus, itemPatch }) => {
  const { items, ...agreementSnapshot } = structuredClone(agreement.toDocument());
  delete agreementSnapshot.sbi;

  return {
    ...agreementSnapshot,
    items: agreement.items.map((item) =>
      createItemSnapshot({ item, initialStatus, itemPatch }),
    ),
  };
};
