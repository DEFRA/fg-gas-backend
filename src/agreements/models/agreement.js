import { AgreementItem } from "./agreement-item.js";
import { AgreementVersion } from "./agreement-version.js";

export class Agreement {
  constructor(document, options = {}) {
    this.document = document;
    this.id = document._id;
    this.agreementNumber = document.agreementNumber;
    this.code = getAgreementCode(document);
    this.identifiers = getAgreementIdentifiers(document);
    this.sbi = this.identifiers.sbi;
    this.items = getAgreementItems({ document, items: options.items });
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
      code: definition.agreementCode ?? definition.code,
      identifiers: createAgreementIdentifiers(command),
      createdAt: now,
      updatedAt: now,
      items: [item.toDocument()],
    };
    return new Agreement(document, { items: [item] });
  }

  findItemForCommand({ command, definition }) {
    if (this.code !== (definition.agreementCode ?? definition.code)) {
      return undefined;
    }

    return this.items.find((item) =>
      item.matches({
        clientRef: command.clientRef,
      }),
    );
  }

  createInitialVersion({ versionId, initialStatus, createdAt, itemPatch }) {
    return AgreementVersion.initial({
      id: versionId,
      agreement: this,
      initialStatus,
      createdAt,
      itemPatch,
    });
  }

  toDocument() {
    return this.document;
  }
}

const getAgreementCode = (document) => {
  const [item = {}] = document.items || [];
  return document.code || item.agreementCode;
};

const getAgreementIdentifiers = (document) => ({
  ...(document.identifiers || {}),
  ...(document.sbi ? { sbi: document.sbi } : {}),
});

const createAgreementIdentifiers = ({ identifiers = {} }) => ({
  sbi: identifiers.sbi,
  frn: identifiers.frn,
  crn: identifiers.crn,
});

const getAgreementItems = ({ document, items }) =>
  items || (document.items || []).map(AgreementItem.fromDocument);
