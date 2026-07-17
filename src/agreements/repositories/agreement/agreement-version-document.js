import { AgreementDocument } from "./agreement-document.js";

export class AgreementVersionDocument {
  constructor(version) {
    this._id = version.id;
    this.agreementId = version.agreementId;
    this.agreementNumber = version.agreementNumber;
    this.version = version.version;
    this.snapshot = new AgreementDocument(version.snapshot);
    this.createdAt = version.createdAt;
    if (version.actionExecution) {
      this.actionExecution = version.actionExecution;
    }
  }
}
