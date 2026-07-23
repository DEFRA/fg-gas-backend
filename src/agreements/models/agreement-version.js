import { randomUUID } from "node:crypto";
import { Agreement } from "./agreement.js";

export class AgreementVersion {
  constructor({
    id,
    agreementId,
    agreementNumber,
    version,
    snapshot,
    createdAt,
    actionExecution,
  }) {
    this.id = id;
    this.agreementId = agreementId;
    this.agreementNumber = agreementNumber;
    this.version = version;
    this.snapshot =
      snapshot instanceof Agreement ? snapshot : new Agreement(snapshot);
    this.createdAt = createdAt;
    this.actionExecution = actionExecution;
  }

  static new({
    agreementId,
    agreementNumber,
    version,
    snapshot,
    actionExecution,
  }) {
    return new AgreementVersion({
      id: randomUUID(),
      agreementId,
      agreementNumber,
      version,
      snapshot,
      createdAt: new Date().toISOString(),
      actionExecution,
    });
  }
}
