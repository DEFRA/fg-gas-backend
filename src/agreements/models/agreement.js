import { randomUUID } from "node:crypto";

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
