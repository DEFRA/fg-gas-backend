import { randomUUID } from "node:crypto";

const matchesIdentity = (agreement, identity) =>
  [
    agreement.agreementNumber === identity.agreementNumber,
    agreement.code === identity.code,
    agreement.identifiers?.sbi === identity.sbi,
  ].every(Boolean);

export class Agreement {
  constructor({
    id,
    agreementNumber,
    code,
    identifiers,
    items,
    createdAt,
    updatedAt,
  }) {
    this.id = id;
    this.agreementNumber = agreementNumber;
    this.code = code;
    this.identifiers = identifiers;
    this.items = items;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  findItemForIdentity(identity) {
    if (!matchesIdentity(this, identity)) {
      return undefined;
    }

    return (this.items ?? []).find(
      (item) =>
        item.agreementCode === identity.code &&
        item.clientRef === identity.clientRef,
    );
  }

  static new({ agreementNumber, code, identifiers, items }) {
    const now = new Date().toISOString();
    return new Agreement({
      id: randomUUID(),
      agreementNumber,
      code,
      identifiers,
      items,
      createdAt: now,
      updatedAt: now,
    });
  }
}
