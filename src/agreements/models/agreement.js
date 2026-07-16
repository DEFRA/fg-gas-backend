import { randomUUID } from "node:crypto";
import { AgreementReference } from "./agreement-reference.js";

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

  resolveReference({ code, clientRef, sbi }) {
    const values = {
      agreementNumber: this.agreementNumber,
      code,
      clientRef,
      sbi,
    };

    if (!this.#findReferencedItem(values)) {
      return undefined;
    }

    return new AgreementReference(values);
  }

  resolveItemReference(agreementItemId) {
    const item = (this.items ?? []).find(
      (candidate) => candidate.agreementItemId === agreementItemId,
    );

    if (!item) {
      return undefined;
    }

    return this.resolveReference({
      code: item.agreementCode,
      clientRef: item.clientRef,
      sbi: item.identifiers?.sbi,
    });
  }

  findItem(reference) {
    if (!(reference instanceof AgreementReference)) {
      throw new TypeError(
        "Agreement item lookup requires an Agreement Reference",
      );
    }

    return this.#findReferencedItem(reference);
  }

  #findReferencedItem(reference) {
    const matchesAgreement = [
      this.agreementNumber === reference.agreementNumber,
      this.code === reference.code,
      this.identifiers?.sbi === reference.sbi,
    ].every(Boolean);

    if (!matchesAgreement) {
      return undefined;
    }

    return (this.items ?? []).find(
      (item) =>
        item.agreementCode === reference.code &&
        item.clientRef === reference.clientRef &&
        item.identifiers?.sbi === reference.sbi,
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
