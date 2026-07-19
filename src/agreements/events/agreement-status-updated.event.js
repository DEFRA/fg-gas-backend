import { randomUUID } from "node:crypto";

export class AgreementStatusUpdatedEvent {
  constructor(data) {
    this.id = randomUUID();
    this.source = "urn:service:agreement";
    this.specversion = "1.0";
    this.type = "io.onsite.agreement.status.updated";
    this.time = new Date().toISOString();
    this.datacontenttype = "application/json";
    this.data = data;
  }
}
