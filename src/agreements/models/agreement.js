import { AgreementItem } from "./agreement-item.js";
import { AgreementVersion } from "./agreement-version.js";

export class Agreement {
  constructor(document) {
    this.document = document;
    this.id = document._id;
    this.agreementNumber = document.agreementNumber;
    this.sbi = document.sbi;
    this.items = (document.items ?? []).map(AgreementItem.fromDocument);
  }

  static fromDocument(document) {
    return new Agreement(document);
  }

  static createFromCommand({
    command,
    definition,
    now,
    agreementId,
    agreementNumber,
    agreementItemId,
  }) {
    const item = AgreementItem.create({
      command,
      definition,
      now,
      agreementItemId,
    });
    const document = {
      _id: agreementId,
      agreementNumber,
      sbi: command.identifiers?.sbi,
      createdAt: now,
      updatedAt: now,
      items: [item.toDocument()],
    };
    return new Agreement(document);
  }

  findItemForCommand({ command, definition }) {
    return this.items.find((item) =>
      item.matches({
        agreementCode: definition.agreementCode,
        clientRef: command.clientRef,
      }),
    );
  }

  createInitialVersion({ versionId, initialVersion, createdAt }) {
    return AgreementVersion.initial({
      id: versionId,
      agreement: this,
      initialVersion,
      createdAt,
    });
  }

  toDocument() {
    return this.document;
  }
}
