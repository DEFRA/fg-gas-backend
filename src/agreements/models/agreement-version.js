import { Agreement } from "./agreement.js";

export class AgreementVersion {
  constructor({
    agreementNumber,
    version,
    snapshot,
    versionedAt,
    actionExecution,
  }) {
    this.agreementNumber = agreementNumber;
    this.version = version;
    this.snapshot =
      snapshot instanceof Agreement ? snapshot : new Agreement(snapshot);
    this.versionedAt = versionedAt;
    this.actionExecution = actionExecution;
  }

  static create({ agreement, versionedAt = new Date().toISOString() }) {
    return new AgreementVersion({
      agreementNumber: agreement.agreementNumber,
      version: agreement.version,
      snapshot: agreement,
      versionedAt,
    });
  }
}
