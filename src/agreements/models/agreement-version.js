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
  }) {
    this.id = id;
    this.agreementId = agreementId;
    this.agreementNumber = agreementNumber;
    this.version = version;
    this.snapshot =
      snapshot instanceof Agreement ? snapshot : new Agreement(snapshot);
    this.createdAt = createdAt;
  }

  static new({ agreementId, agreementNumber, version, snapshot }) {
    return new AgreementVersion({
      id: randomUUID(),
      agreementId,
      agreementNumber,
      version,
      snapshot,
      createdAt: new Date().toISOString(),
    });
  }
}
