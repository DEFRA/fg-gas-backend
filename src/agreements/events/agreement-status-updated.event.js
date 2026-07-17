import { CloudEvent } from "../../common/cloud-event.js";

export class AgreementStatusUpdatedEvent extends CloudEvent {
  constructor({ agreementNumber, clientRef, code, version, status, date }) {
    super(
      "agreement.status.updated",
      { agreementNumber, clientRef, code, version, status, date },
      `${clientRef}-${code}`,
    );
  }
}
