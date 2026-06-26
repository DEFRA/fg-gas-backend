export class AgreementDocument {
  constructor(agreement) {
    this._id = agreement.id;
    this.agreementNumber = agreement.agreementNumber;
    this.code = agreement.code;
    this.identifiers = agreement.identifiers;
    this.items = agreement.items;
    this.createdAt = agreement.createdAt;
    this.updatedAt = agreement.updatedAt;
  }
}
