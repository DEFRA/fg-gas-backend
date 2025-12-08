import { CloudEvent } from "../../common/cloud-event.js";

export class UpdateAgreementStatusCommand extends CloudEvent {
  constructor(command) {
    super("agreement.status.update", {
      clientRef: command.clientRef,
      code: command.code,
      status: command.status,
      agreementNumber: command.agreementNumber,
    });
  }
}
