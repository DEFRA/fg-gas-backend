import { CloudEvent } from "../../common/cloud-event.js";

export class AgreementWithdrawnEvent extends CloudEvent {
  constructor(props) {
    super("agreement.withdraw", {
      clientRef: props.clientRef,
      id: props.id,
      status: props.status,
      withdrawnAt: props.withdrawnAt,
      withdrawnBy: props.withdrawnBy,
    });
  }
}
